import {Link2,Unplug} from 'lucide-react';
import {useBridgeStatus,type BridgeState} from './bridge';

const LABEL:Record<BridgeState,(client:string)=>string>={
 connecting:client=>`Connecting to ${client}`,
 connected:client=>`Driven by ${client}`,
 disconnected:client=>`${client} disconnected, retrying`,
 replaced:()=>'Driven from another tab',
 rejected:()=>'Automation link refused: open a new link',
};

/**
 * In the header, while a tool on this computer drives the page through the automation bridge
 * (docs/AUTOMATION_API.md#bridge): who drives it, from which address, and a button to cut the link.
 */
export function BridgeBadge(){
 const {state,client='an automation tool',address,disconnect}=useBridgeStatus();
 if(!state)return null;
 return <span className={`bridge-badge ${state}`} role="status" title="A tool on this computer opens projects and renders through the automation API">
  <Link2 size={14}/><strong>{LABEL[state](client)}</strong>{address&&<code>{address}</code>}
  {disconnect&&<button type="button" onClick={disconnect} title="Disconnect this page from the tool" aria-label="Disconnect this page from the tool"><Unplug size={13}/>Disconnect</button>}
 </span>;
}
