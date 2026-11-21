import type {Env} from './db';
import type {AuthSession} from './auth';
// Object identity, never a client header or a serialized binding. Each DO request
// creates a fresh environment and registers only the identity verified by Worker.
const sessions=new WeakMap<Env,AuthSession>();
export function registerTenantSession(env:Env,session:AuthSession){sessions.set(env,session);}
export function tenantSession(env:Env){return sessions.get(env);}
