#!/usr/bin/env python3
"""Deterministic Provider Protocol v1 reference implementation using only Python stdlib."""

import datetime
import json
import os
import sys
import time

PROTOCOL = "omniseed.provider.protocol/1.0"
METHODS = [
    "provider.initialize", "provider.status", "provider.validate", "provider.plan",
    "provider.apply", "provider.observe", "provider.invoke", "provider.shutdown"
]
MODE = os.environ.get("OMNISEED_PYTHON_PROVIDER_MODE", "normal")
RESOURCES = {}

if MODE == "startup_failure":
    print("reference provider failed during startup", file=sys.stderr, flush=True)
    sys.exit(12)


def respond(request_id, result=None, error=None):
    message = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        message["error"] = error
    else:
        message["result"] = result
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def initialized():
    protocol = "omniseed.provider.protocol/9.9" if MODE == "version_mismatch" else PROTOCOL
    provider_id = "wrong_python_provider" if MODE == "id_mismatch" else "python_reference"
    resource = {
        "family": "connectors", "id": "python_service", "name": "Python Reference Connector",
        "offers": ["access_service"]
    }
    return {
        "protocolVersion": protocol,
        "provider": {"id": provider_id, "name": "Python Reference Provider", "version": "1.0.0"},
        "primitiveFamilies": ["connectors"],
        "offerings": [{"family": "connectors", "id": "access_service", "resource": resource}],
        "operations": ["echo"],
        "methods": METHODS
    }


def status():
    healthy = MODE != "unhealthy"
    return {"implementation_available": True, "configured": True, "connected": True, "healthy": healthy}


def handle(method, params):
    if method == "provider.initialize":
        if MODE == "diagnostic":
            print("python provider diagnostic", file=sys.stderr, flush=True)
        return initialized()
    if method == "provider.status":
        if MODE == "timeout":
            time.sleep(2)
        if MODE == "invalid_response":
            return {"implementation_available": True, "configured": True, "connected": True, "healthy": "yes"}
        return status()
    if method == "provider.validate":
        if MODE == "crash":
            os._exit(17)
        action = params.get("action") or {}
        valid = action.get("family") == "connectors" and bool(action.get("resourceId"))
        return {"valid": valid, "issues": [] if valid else [{"message": "systems resourceId is required"}]}
    if method == "provider.plan":
        action = params.get("action") or {}
        return {"deterministic": True, "actionId": action.get("id")}
    if method == "provider.apply":
        action = params.get("action") or {}
        if MODE == "invalid_apply":
            return {"status": "deployed"}
        resource_id = action.get("resourceId")
        record = {
            "providerResourceId": "python_reference/systems/" + str(resource_id),
            "status": "deployed",
            "attributes": (action.get("desired") or {}).get("spec", {})
        }
        RESOURCES[resource_id] = record
        return record
    if method == "provider.observe":
        resource = params.get("resource") or {}
        resource_id = resource.get("id")
        exists = resource_id in RESOURCES
        observed = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        return {
            "status": "healthy" if exists else "missing",
            "checkedAt": observed,
            "providerResourceId": resource.get("providerResourceId"),
            "evidence": [{
                "type": "python_reference_observation",
                "source": "python_reference",
                "value": "healthy" if exists else "missing",
                "providerVersion": "1.0.0"
            }]
        }
    if method == "provider.invoke":
        operation = params.get("operation")
        if operation != "echo":
            raise KeyError("unsupported Provider operation: " + str(operation))
        return {"echo": params.get("input"), "actor": params.get("actor")}
    if method == "provider.shutdown":
        return {"shutdown": True}
    raise NotImplementedError(method)


for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request.get("id")
        if request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str):
            respond(request_id, error={"code": -32600, "message": "Invalid Request"})
            continue
        if MODE == "malformed" and request["method"] == "provider.initialize":
            sys.stdout.write("this is not json\n")
            sys.stdout.flush()
            continue
        try:
            result = handle(request["method"], request.get("params") or {})
            respond(request_id, result=result)
            if request["method"] == "provider.shutdown":
                break
        except NotImplementedError:
            respond(request_id, error={"code": -32601, "message": "Method not found"})
        except KeyError as error:
            respond(request_id, error={"code": -32602, "message": str(error)})
        except Exception as error:  # The protocol converts provider failure into a JSON-RPC error.
            respond(request_id, error={"code": -32000, "message": str(error)})
    except json.JSONDecodeError:
        respond(None, error={"code": -32700, "message": "Parse error"})
