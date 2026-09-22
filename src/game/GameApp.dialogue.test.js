// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { GameApp } from './GameApp.js';
import { QuestSession } from './quests/QuestSession.js';
import { QuestActions } from './quests/QuestActions.js';
import { GameClock } from './time/GameClock.js';
import { npc, quest, role, simulation, step } from './quests/quest.test-fixtures.js';

function fixture( ending = false ) {
 const opening = step('ask', { kind:'talk', roleId:'giver', atParcelId:'p1' }, { gives:['lead'], next:[{toStepId:'visit',when:[]}] });
 opening.dialogue = { opening:'My brother never came home. Kip found something near the quay.', choices:[
  {id:'background',text:'Tell me about your brother.',reply:'He worked the cranes. He always came home before dawn.',completesStep:false},
  {id:'accept',text:'I will find Kip and ask what he saw.',reply:'Look for him at the market. Tell him Petra sent you.',completesStep:true}
 ]};
 if (ending) { opening.next=[];opening.endingId='done'; }
 const definition = quest('missing_person', {roles:[role('giver','vendor')],items:[{itemId:'lead',kind:'information',name:'Kip at the market',description:'Ask Kip about the quay.'}],steps:ending?[opening]:[opening,step('visit',{kind:'goto',place:{parcelId:'p2'}},{needs:['lead'],endingId:'done'})]});
 const person=npc('person','vendor','p1');person.name={given:'Petra',family:'Moss'};
 const sim=simulation(new Map([[person.npcId,person]]));
 const app=new GameApp({});app.clock={timeMin:1260};app.quests=QuestSession.create([definition],sim,1260);
 const actions=new QuestActions(app.quests);
 app.questGameplay={objective:(timeMin,questId)=>actions.objective({timeMin,...(questId?{questId}:{})})};
 app.venues={setObjective:()=>false,nameOf:()=> 'Market'};
 app.savedInventory=[];app.questItemIds=['lead'];app.input={exitLock:vi.fn(),requestLock:vi.fn()};
 app.animations={npcDialogueTurn:vi.fn(),playerDialogueTurn:vi.fn(),completeDialogueTurn:vi.fn()};
 app.talk={say:vi.fn(async()=> 'I wish I had more to tell you.')};
 app.interactor={conversation:null,close(){this.conversation=null;app.presentConversation(null);}};
 const open=()=>{app.interactor.conversation={npcId:person.npcId,instance:person,behavior:null};app.presentConversation(app.interactor.conversation);};
 const state=()=>app.quests.snapshot()[0].state;
 return{app,open,state};
}

beforeEach(()=>{document.body.replaceChildren();stubCanvas();});

describe('explicit quest dialogue through the playable UI',()=>{
 it('keeps questions and goodbye noncommitting, advances one chosen reply, and updates the same journal and HUD',async()=>{
  const {app,open,state}=fixture();const user=userEvent.setup();open();
  const chat=within(app.view.dialog.element);
  expect(chat.getByText(/My brother never came home/)).toBeTruthy();
  expect(chat.queryByText(/working @ parcel/)).toBeNull();
  const initial=structuredClone(state());
  await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  expect(chat.getByText(/He worked the cranes/)).toBeTruthy();expect(state()).toEqual(initial);
  await user.click(chat.getByRole('button',{name:'End conversation'}));expect(state()).toEqual(initial);
  open();await user.type(chat.getByRole('textbox',{name:'say something'}),'hello{Enter}');
  await vi.waitFor(()=>expect(chat.getByText('I wish I had more to tell you.')).toBeTruthy());expect(state()).toEqual(initial);
  const choice=chat.getByRole('button',{name:'I will find Kip and ask what he saw.'});await user.click(choice);choice.click();
	 expect(document.activeElement).toBe(chat.getByRole('button',{name:'End conversation'}));
  expect(state().completedStepIds).toEqual(['ask']);expect(state().activeStepIds).toEqual(['visit']);
  expect(app.quests.inventoryView()).toHaveLength(1);
  expect(chat.getByText(/Look for him at the market/)).toBeTruthy();
  expect(chat.getByRole('status').textContent).toContain('Journal updated:');
  expect(app.view.objective.element.textContent).toContain('visit');
  expect(app.view.quests.quests[0].steps.find(s=>s.stepId==='visit').state).toBe('active');
  await user.click(chat.getByRole('button',{name:'End conversation'}));expect(state().completedStepIds).toEqual(['ask']);
  open();expect(chat.getByText(/Look for him at the market/)).toBeTruthy();
  await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  expect(chat.getByText(/He worked the cranes/)).toBeTruthy();expect(state().completedStepIds).toEqual(['ask']);
 });

 it('serializes typed requests, discards late replies, and keeps offline story choices usable',async()=>{
  const {app,open,state}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  let resolve;app.talk.say.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await user.type(chat.getByRole('textbox'),'hello{Enter}');
  expect(chat.getByRole('textbox').disabled).toBe(true);
  expect(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}).disabled).toBe(false);
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  resolve('This delayed reply must not replace the new lead.');await Promise.resolve();
  expect(chat.queryByText(/This delayed reply/)).toBeNull();expect(state().completedStepIds).toEqual(['ask']);
  app.talk.say.mockRejectedValueOnce(new Error('offline'));
  await user.type(chat.getByRole('textbox'),'thanks{Enter}');
  await vi.waitFor(()=>expect(chat.getByRole('button',{name:'Retry reply'})).toBeTruthy());
  expect(chat.queryByText('...')).toBeNull();
  const count=chat.getAllByText('thanks').length;await user.click(chat.getByRole('button',{name:'Retry reply'}));
  await vi.waitFor(()=>expect(chat.getByText('I wish I had more to tell you.')).toBeTruthy());
  expect(chat.getAllByText('thanks')).toHaveLength(count);expect(state().completedStepIds).toEqual(['ask']);
 });
 it('shows an ending after the final reply is read, and Continue closes the outcome and returns control',async()=>{
  const {app,open,state}=fixture(true);open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  expect(state().endingId).toBe('done');expect(app.view.dialog.element.hidden).toBe(false);
  expect(app.view.summary.element.hidden).toBe(true);
  await user.click(chat.getByRole('button',{name:'End conversation'}));
  expect(app.view.summary.element.hidden).toBe(false);expect(app.input.requestLock).not.toHaveBeenCalled();
  app.view.setPaused(true);expect(app.view.pause.element.hidden).toBe(true);
  await user.click(within(app.view.summary.element).getByRole('button',{name:'continue'}));
  expect(app.view.summary.element.hidden).toBe(true);expect(app.input.requestLock).toHaveBeenCalledOnce();
 });

 it('waits forward to an authored opening without completing the objective or rewinding time',async()=>{
  const {app,state}=fixture();app.clock=new GameClock({startHour:21});
  const e=app.quests.entries[0];e.definition.steps[0].window={days:[0,1,2,3,4,5],startMin:480,endMin:960,label:'during opening hours'};
  app.view.quests.setQuests(app.quests.view(app.clock.timeMin));app.view.open('QUESTS');
  const user=userEvent.setup(),before=structuredClone(state());
  await user.click(screen.getByRole('button',{name:'Wait until Tue 08:00'}));
  expect(app.clock.timeMin).toBe(1920);expect(state()).toEqual(before);
  expect(screen.queryByRole('button',{name:'Wait until Tue 08:00'})).toBeNull();
 });

});
