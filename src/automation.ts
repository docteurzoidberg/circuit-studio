import {useEditor} from './store';
import {listParts as listLibraryParts} from './library';
import {defaultVideoSettings,validSettings,videoPresets,VIDEO_BACKGROUND_PRESETS,type VideoSettings} from './cinematic';
import {BUILT_IN_MODEL_COMPONENTS,migrateProject,ProjectSchema,type Component,type Project,type Wire} from './model';
import {planAutoWires} from './autoRouting';
import type {Progress} from './videoExport';
// Documented scripting surface (docs/AUTOMATION_API.md). Bump the version on breaking changes.
export const AUTOMATION_API_VERSION=1;
export type PinInfo={id:string;label:string;silkscreen?:string;aliases?:string[];functions?:string[];electrical?:string};
export type PartInfo={modelId:string;name:string;source:'built-in'|'library';dimensions?:[number,number,number];pins:PinInfo[]};
export type ProjectSummary={name:string;components:number;wires:number};
export type RenderVideoOptions={selected?:string[];onProgress?:(progress:Progress)=>void;signal?:AbortSignal};
export type VideoResult={blob:Blob;filename:string;mimeType:string;frames:number;duration:number;warnings:string[]};
export type WireRoute={id:string;blocked:boolean;points?:[number,number,number][]};
export type RoutePlan={blocked:string[];wires:WireRoute[]};
export type CircuitStudioApi={version:number;ready:Promise<void>;openProject:(data:object|string|Blob)=>Promise<ProjectSummary>;getProject:()=>Project;listParts:()=>Promise<PartInfo[]>;capabilities:(settings?:Partial<VideoSettings>)=>Promise<{mp4:boolean;webm:boolean;png:boolean}>;renderImage:(options?:{width?:number;height?:number;transparent?:boolean})=>Promise<Blob>;renderVideo:(settings?:Partial<VideoSettings>,options?:RenderVideoOptions)=>Promise<VideoResult>;planRoutes:(data?:object|string)=>Promise<RoutePlan>;videoSettings:(settings?:Partial<VideoSettings>)=>VideoSettingsInfo};
/** The video settings a render would use, the presets of the Auto Video dialog, and the allowed values of the settings that have a fixed list. */
export type VideoSettingsInfo={settings:VideoSettings;source:'project'|'defaults';presets:Record<string,VideoSettings>;choices:Record<string,readonly (string|number)[]>};
const VIDEO_CHOICES={width:[1920,2560,3840],mode:['tutorial','all','sequential','selected','orbit'],fps:[24,30,60],format:['mp4','webm','png'],cameraStyle:['balanced','elevated'],labels:['minimal','dark','white','none'],hudStyle:['futuristic','classic','minimal','none'],closingLabel:['project-name','connection-summary','none'],backgroundPresetId:VIDEO_BACKGROUND_PRESETS.map(p=>p.id),gradientDirection:['vertical','horizontal','diagonal']} as const;
declare global{interface Window{circuitStudio?:CircuitStudioApi}}
const pinInfo=(c:Pick<Component,'pins'>):PinInfo[]=>c.pins.map(p=>({id:p.id,label:p.label,silkscreen:p.silkscreen,aliases:p.aliases,functions:p.functions,electrical:p.electrical}));
const summary=(p:Project):ProjectSummary=>({name:p.name,components:p.components.length,wires:p.wires.length});
function viewportReady(timeout=30_000){return new Promise<void>((resolve,reject)=>{const started=performance.now(),check=()=>{if(window.__circuitExportState)resolve();else if(performance.now()-started>timeout)reject(new Error('The 3D viewport did not start'));else requestAnimationFrame(check)};check()})}
// After a project is loaded, wire routes come from a worker and models load over several frames:
// wait for the routes, then until the scene stops changing.
async function sceneSettled(stableFrames=30,timeout=60_000){const {wireRoutesReady}=await import('./Workspace');const started=performance.now(),frame=()=>new Promise(r=>requestAnimationFrame(r));await frame();await frame();
 while(!wireRoutesReady()){if(performance.now()-started>timeout)throw new Error('Wire routing did not finish');await frame()}
 let last=-1,stable=0;while(stable<stableFrames&&performance.now()-started<timeout){await frame();let count=0;window.__circuitExportState?.scene.traverse(o=>{if((o as {isMesh?:boolean}).isMesh)count++});stable=count===last?stable+1:0;last=count}}
// Scripts get deterministic settings: the project's stored presentation, else the defaults, then the given overrides.
/** The video settings the project stores (presentation.video), if any. */
const projectVideoSettings=(project:Project):VideoSettings|null=>project.presentation?.video?validSettings(project.presentation.video):null;
export function videoSettingsInfo(project:Project,settings?:Partial<VideoSettings>):VideoSettingsInfo{return {settings:resolveVideoSettings(project,settings),source:projectVideoSettings(project)?'project':'defaults',presets:{...videoPresets},choices:VIDEO_CHOICES}}
export function resolveVideoSettings(project:Project,overrides?:Partial<VideoSettings>):VideoSettings{return validSettings({...(projectVideoSettings(project)??defaultVideoSettings),...overrides})}
// Routes as the workspace computes them: every wire, hidden ones included, against every part.
const routeInput=(project:Project)=>({wires:project.wires.map(w=>({...w,visible:undefined})),components:project.components});
const routePlan=(wires:Wire[]):RoutePlan=>{const routes=wires.map(w=>({id:w.id,blocked:!!w.routingBlocked,points:w.routingPoints}));return {blocked:routes.filter(r=>r.blocked).map(r=>r.id),wires:routes}};
const parseProject=(data:object|string)=>migrateProject(ProjectSchema.parse(typeof data==='string'?JSON.parse(data):data));
export function planProjectRoutes(data:object|string):RoutePlan{const {wires,components}=routeInput(parseProject(data));return routePlan(planAutoWires(wires,components))}
// The API runs the same planner in the routing worker, so a long plan does not freeze the page.
function planInWorker(project:Project){return new Promise<RoutePlan>((resolve,reject)=>{const worker=new Worker(new URL('./routing.worker.ts',import.meta.url),{type:'module'});worker.onmessage=(event:MessageEvent<{wires?:Wire[];error?:string}>)=>{worker.terminate();if(event.data.error)reject(new Error(event.data.error));else resolve(routePlan(event.data.wires??[]))};worker.onerror=()=>{worker.terminate();reject(new Error('Routing failed to start'))};worker.postMessage(routeInput(project))})}
export async function listAutomationParts():Promise<PartInfo[]>{const library=await listLibraryParts().catch(()=>[]);return [...[...BUILT_IN_MODEL_COMPONENTS.values()].map(c=>({modelId:c.modelId,name:c.name,source:'built-in' as const,dimensions:c.dimensions,pins:pinInfo(c)})),...library.map(p=>({modelId:p.modelId,name:p.name,source:'library' as const,dimensions:p.dimensions,pins:pinInfo(p)}))]}
export function createAutomationApi():CircuitStudioApi{const ready=viewportReady();return {version:AUTOMATION_API_VERSION,ready,
 async openProject(data){const {importLegacy,openProject:openProjectFile}=await import('./projectFiles');const project=data instanceof Blob?await openProjectFile(data instanceof File?data:new File([data],'project')):await importLegacy(typeof data==='string'?JSON.parse(data):data);useEditor.getState().loadProject(project);await ready;await sceneSettled();return summary(useEditor.getState().project)},
 getProject:()=>structuredClone({...useEditor.getState().project,assets:undefined}),
 listParts:listAutomationParts,
 planRoutes:data=>planInWorker(data===undefined?useEditor.getState().project:parseProject(data)),
 async capabilities(settings){const {videoCapabilities}=await import('./videoExport');return {...await videoCapabilities(resolveVideoSettings(useEditor.getState().project,settings)),png:true}},
 async renderImage({width=1920,height=1080,transparent=false}={}){await ready;const {renderScenePng}=await import('./Workspace');return renderScenePng(width,height,transparent)},
 videoSettings(settings){return videoSettingsInfo(useEditor.getState().project,settings)},
 async renderVideo(settings,{selected=[],onProgress=()=>{},signal}={}){await ready;
  // Shown in the page like a render from the Auto Video dialog: progress, and a Cancel button that stops it.
  const {useVideoRender,videoAbort}=await import('./videoRender');
  if(videoAbort.current)throw new Error('A video is already being rendered in this page');
  const abort=new AbortController();videoAbort.current=abort;signal?.addEventListener('abort',()=>abort.abort());
  useVideoRender.setState({progress:{stage:'Starting',frame:0,total:0,percent:0},message:''});
  try{const project=useEditor.getState().project,resolved=resolveVideoSettings(project,settings),{exportCinematic}=await import('./videoExport');
   const result=await exportCinematic(project,resolved,selected,progress=>{useVideoRender.setState({progress});onProgress(progress)},abort.signal);
   if(!result.blob)throw new Error('The video was written to a file instead of memory');
   useVideoRender.setState({message:`Rendered ${result.filename} · ${result.frames} frames, handed to the automation client.`});
   return {blob:result.blob,filename:result.filename,mimeType:result.blob.type,frames:result.frames,duration:result.sequence.duration,warnings:result.sequence.warnings}}
  catch(error){useVideoRender.setState({message:error instanceof Error?error.message:String(error)});throw error}
  finally{useVideoRender.setState({progress:null});videoAbort.current=null}}}}
export function installAutomationApi(){if(!window.circuitStudio)window.circuitStudio=createAutomationApi()}
