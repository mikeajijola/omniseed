# Hosted runtime

The hosted runtime exposes the same `/operations/{operation}` boundary as local OmniSeed. Vercel Functions are a replaceable host; they are not the state store or source of company truth.

Hosted mode uses the same relational schema through a SQLite-compatible remote driver. The current fetch-only adapter accepts `OMNISEED_DATABASE_URL` and `OMNISEED_DATABASE_AUTH_TOKEN`; `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are deployment aliases. These select an implementation—Turso and Vercel are not domain concepts.

Local mode uses a standard SQLite file and requires no account, daemon, Docker, Redis, or network connection. Anonymous hosted requests receive `read_company` authority only. Mutations require an owner credential held server-side or in an HTTP-only session cookie. Provider and database credentials never enter portable state or browser responses.

Schedules remain Omniform intent. The self-contained runtime runs due interval and one-shot schedules through the normal operation boundary. A hosted trigger such as Vercel Cron may invoke that scheduler later without changing Schedule semantics.

The previous hosted key-value adapter remains available only for compatibility. It is not the canonical persistence model.
