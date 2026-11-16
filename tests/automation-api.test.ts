import 'fake-indexeddb/auto';
import {describe,expect,it} from 'vitest';
import fixture from './fixtures/crowded-c6-project.json';
import {ProjectSchema} from '../src/model';
import {defaultVideoSettings} from '../src/cinematic';
import {AUTOMATION_API_VERSION,listAutomationParts,planProjectRoutes,resolveVideoSettings,videoSettingsInfo} from '../src/automation';
import {BUILT_IN_MODEL_COMPONENTS} from '../src/model';

const project=()=>ProjectSchema.parse(fixture);

describe('automation API',()=>{
 it('has a version',()=>{expect(AUTOMATION_API_VERSION).toBe(1)});
 it('lists built-in parts with their pins',async()=>{const parts=await listAutomationParts();expect(parts.filter(p=>p.source==='built-in')).toHaveLength(BUILT_IN_MODEL_COMPONENTS.size);const c6=parts.find(p=>p.modelId==='esp32-c6-supermini')!;expect(c6.pins.length).toBeGreaterThan(20);expect(c6.pins[0]).toHaveProperty('id');expect(c6.pins[0]).toHaveProperty('label')});
 it('uses defaults when the project stores no settings',()=>{expect(resolveVideoSettings(project())).toEqual(defaultVideoSettings)});
 it('uses the settings stored in the project, then the given overrides',()=>{const stored={...project(),presentation:{video:{...defaultVideoSettings,fps:24,backgroundPresetId:'pure-white' as const},cameraScenes:[]}};expect(resolveVideoSettings(stored)).toMatchObject({fps:24,backgroundPresetId:'pure-white'});expect(resolveVideoSettings(stored,{fps:60})).toMatchObject({fps:60,backgroundPresetId:'pure-white'})});
 it('plans the routes of a project without opening it',()=>{const plan=planProjectRoutes(JSON.stringify(fixture));expect(plan.wires.map(w=>w.id)).toEqual(fixture.wires.map(w=>w.id));expect(plan.blocked).toEqual([]);for(const wire of plan.wires)expect(wire.points!.length).toBeGreaterThan(1)},60_000);
 it('reports a wire with no route as blocked',()=>{const base=ProjectSchema.parse(fixture),wire=base.wires.find(w=>w.routeMode==='clean')!,from=base.components.find(c=>c.id===wire.from.componentId)!;
  // A large part lying over the source part leaves the wire nowhere to go.
  const blocker={...from,id:'blocker',modelId:'generic-pcb',name:'Blocker',pins:[],geometry:{kind:'procedural-pcb' as const},dimensions:[200,200,40] as [number,number,number]};
  const alone=planProjectRoutes({...base,wires:[wire],wireOrder:[wire.id]}),covered=planProjectRoutes({...base,components:[...base.components,blocker],wires:[wire],wireOrder:[wire.id]});
  expect(alone.blocked).toEqual([]);expect(covered.blocked).toEqual([wire.id]);expect(covered.wires[0]).toMatchObject({id:wire.id,blocked:true});expect(covered.wires[0].points).toBeUndefined()});
 it('describes the video settings, their source, presets and allowed values',()=>{const info=videoSettingsInfo(project(),{fps:60,mode:'nope' as never});expect(info.source).toBe('defaults');expect(info.settings).toMatchObject({fps:60,mode:'tutorial'});expect(Object.keys(info.presets)).toContain('Final Circuit Showcase');expect(info.choices.fps).toEqual([24,30,60]);expect(info.choices.backgroundPresetId).toContain('pure-white');
  const stored={...project(),presentation:{video:{...defaultVideoSettings,fps:24},cameraScenes:[]}};expect(videoSettingsInfo(stored)).toMatchObject({source:'project',settings:{fps:24}})});
 it('sanitizes overrides',()=>{expect(resolveVideoSettings(project(),{width:123 as never})).toMatchObject({width:1920})});
});
