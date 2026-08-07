export class OmniSeedScheduler {
  constructor({host,scheduleStore,companyId,clock=()=>new Date()}={}){Object.assign(this,{host,scheduleStore,companyId,clock})}
  async tick(){const at=this.clock(),due=await this.scheduleStore.due(this.companyId,at),results=[];for(const schedule of due){try{const invocation=schedule.invokes||{},operation=invocation.operation||invocation.workflow||invocation.observation;if(!operation)throw new Error(`Schedule ${schedule.id} has no supported invocation`);const result=await this.host.invoke('executeOperation',{id:operation,input:invocation.input||{},authorization:{actorId:`schedule:${schedule.id}`,permissions:schedule.permissions||[]}});results.push({scheduleId:schedule.id,status:'completed',result})}catch(error){results.push({scheduleId:schedule.id,status:'failed',error:error.message})}finally{await this.scheduleStore.recordRun(this.companyId,schedule,at)}}return results}
}

export class InProcessScheduler {
  constructor({scheduler,intervalMs=30_000}={}){this.scheduler=scheduler;this.intervalMs=intervalMs}
  start(){if(!this.timer){this.timer=setInterval(()=>this.scheduler.tick().catch(error=>console.error('Scheduled invocation failed',error)),this.intervalMs);this.timer.unref?.()}return this}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
}
