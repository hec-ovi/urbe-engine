// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { GameApp } from './GameApp.js';
import { QuestSession } from './quests/QuestSession.js';
import { QuestActions } from './quests/QuestActions.js';
import { GameClock } from './time/GameClock.js';
import { npc, quest, role, simulation, step } from './quests/quest.test-fixtures.js';
import { replyEvents, talkError, talkStream } from './talk/talk.test-fixtures.js';

function fixture( ending = false ) {
 const opening = step('ask', { kind:'talk', roleId:'giver', atParcelId:'p1' }, { gives:['lead'], next:[{toStepId:'visit',when:[]}] });
 opening.dialogue = { opening:'My brother never came home. Kip found something near the quay.', choices:[
  {id:'background',text:'Tell me about your brother.',reply:'[sigh] He worked the cranes. He always came home before dawn.',completesStep:false},
  {id:'accept',text:'I will find Kip and ask what he saw.',reply:'Look for him at the market. Tell him Petra sent you.',completesStep:true}
 ]};
 if (ending) { opening.next=[];opening.endingId='done'; }
 const definition = quest('missing_person', {roles:[role('giver','vendor')],items:[{itemId:'lead',kind:'information',name:'Kip at the market',description:'Ask Kip about the quay.'}],steps:ending?[opening]:[opening,step('visit',{kind:'goto',place:{parcelId:'p2'}},{needs:['lead'],endingId:'done'})]});
 const person=npc('person','vendor','p1');person.name={given:'Petra',family:'Moss'};
 const sim=simulation(new Map([[person.npcId,person]]));
 const observer={said:vi.fn(),silenced:vi.fn()};
 const app=new GameApp({},{lineObserver:observer});app.clock={timeMin:1260};app.quests=QuestSession.create([definition],sim,1260);
 const actions=new QuestActions(app.quests);
 app.questGameplay={objective:(timeMin,questId)=>actions.objective({timeMin,...(questId?{questId}:{})})};
 app.venues={setObjective:()=>false,nameOf:()=> 'Market'};
 app.savedInventory=[];app.questItemIds=['lead'];app.input={exitLock:vi.fn(),requestLock:vi.fn()};
 app.animations={npcDialogueTurn:vi.fn(),playerDialogueTurn:vi.fn(),completeDialogueTurn:vi.fn()};
 app.talk={stream:vi.fn(()=>talkStream(replyEvents('I wish I had more to tell you.')))};
 app.interactor={conversation:null,close(){this.conversation=null;app.presentConversation(null);}};
 const open=()=>{app.interactor.conversation={npcId:person.npcId,instance:person,behavior:null};app.presentConversation(app.interactor.conversation);};
 const state=()=>app.quests.snapshot()[0].state;
 return{app,open,state,observer};
}

beforeEach(()=>{document.body.replaceChildren();stubCanvas();vi.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());

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
  let resolve;app.talk.stream.mockImplementationOnce(()=>talkStream([new Promise(done=>{resolve=done;})]));
  await user.type(chat.getByRole('textbox'),'hello{Enter}');
  expect(chat.getByRole('textbox').disabled).toBe(true);
  expect(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}).disabled).toBe(false);
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  resolve({type:'delta',text:'This delayed reply must not replace the new lead.'});await new Promise(done=>setTimeout(done,0));
  expect(chat.queryByText(/This delayed reply/)).toBeNull();expect(state().completedStepIds).toEqual(['ask']);
  app.talk.stream.mockImplementationOnce(()=>talkStream([],new Error('offline')));
  await user.type(chat.getByRole('textbox'),'thanks{Enter}');
  await vi.waitFor(()=>expect(chat.getByRole('button',{name:'Retry reply'})).toBeTruthy());
  expect(chat.queryByText('...')).toBeNull();
  const count=chat.getAllByText('thanks').length;await user.click(chat.getByRole('button',{name:'Retry reply'}));
  await vi.waitFor(()=>expect(chat.getByText('I wish I had more to tell you.')).toBeTruthy());
  expect(chat.getAllByText('thanks')).toHaveLength(count);expect(state().completedStepIds).toEqual(['ask']);
 });
 it('passes every NPC line through one speaking turn and the line observer, silenced whenever the player takes the turn',async()=>{
  const {app,open,observer}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  expect(chat.getByText('vendor')).toBeTruthy();expect(app.view.dialog.element.textContent).not.toMatch(/p1|working/);
  await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  await user.click(chat.getByRole('button',{name:'End conversation'}));
  open();await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  const said=observer.said.mock.calls.map(([heard])=>heard);
  expect(said.map(heard=>heard.text)).toEqual(['My brother never came home. Kip found something near the quay.','[sigh] He worked the cranes. He always came home before dawn.',
   'Look for him at the market. Tell him Petra sent you.','Look for him at the market. Tell him Petra sent you.','[sigh] He worked the cranes. He always came home before dawn.']);
  for(const heard of said){expect(heard.line.classList.contains('is-npc')).toBe(true);expect(heard.line.lastElementChild.textContent).toBe(heard.text.replace('[sigh] ',''));expect(heard.line.firstElementChild.textContent).toBe('Petra Moss');}
  expect(app.view.dialog.transcript.textContent).not.toContain('[sigh]');
  expect(app.animations.npcDialogueTurn).toHaveBeenCalledTimes(5);
  expect(observer.silenced).toHaveBeenCalledTimes(6);
 });

 it('streams a typed reply into one growing line heard by sentence, and turns its offers into actions that change nothing yet',async()=>{
  const {app,open,state,observer}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  let release;const rest=new Promise(done=>{release=done;});
  app.talk.stream.mockImplementationOnce(()=>talkStream([{type:'delta',text:'Kip drinks '},rest,{type:'sentence',index:0,text:'Kip drinks [sigh] at the market.'},
   {type:'offer',kind:'lead',placeId:'p2',name:'Market'},{type:'offer',kind:'follow'},{type:'done',reply:'Kip drinks [sigh] at the market.'}]));
  const initial=structuredClone(state());observer.said.mockClear();
  await user.type(chat.getByRole('textbox'),'where is Kip?{Enter}');
  await vi.waitFor(()=>expect(chat.getByText('Kip drinks')).toBeTruthy());
  expect(chat.getByRole('textbox').disabled).toBe(true);expect(chat.queryByText(/Waiting for a reply/)).toBeNull();
  expect(observer.said).not.toHaveBeenCalled();expect(app.animations.npcDialogueTurn).toHaveBeenCalledTimes(2);
  release({type:'delta',text:'[sigh] at the market.'});
  await vi.waitFor(()=>expect(chat.getByText('Kip drinks at the market.')).toBeTruthy());
  const line=chat.getByText('Kip drinks at the market.').closest('.chat-line');
  expect(line.lastElementChild.textContent).toBe('Kip drinks at the market.');
  expect(observer.said).toHaveBeenCalledExactlyOnceWith({conversation:app.interactor.conversation,line,text:'Kip drinks [sigh] at the market.'});
  expect(app.animations.npcDialogueTurn).toHaveBeenCalledTimes(2);expect(chat.getByRole('textbox').disabled).toBe(false);
  const actions=within(chat.getByRole('group',{name:'Suggested actions'}));
  expect(actions.getAllByRole('button').map(button=>button.textContent)).toEqual(['Go with Petra to Market','Bring Petra along']);
  const info=vi.spyOn(console,'info').mockImplementation(()=>{});
  await user.click(actions.getByRole('button',{name:'Bring Petra along'}));
  expect(info).toHaveBeenCalledExactlyOnceWith('dialogue offer chosen, not acted on:',{type:'offer',kind:'follow'});expect(state()).toEqual(initial);
  await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  expect(chat.queryByRole('group',{name:'Suggested actions'})).toBeNull();
 });

 it('drops a failed half reply and offers Retry, but says a refused line cannot be retried',async()=>{
  const {app,open,observer}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  app.talk.stream.mockImplementationOnce(()=>talkStream([{type:'delta',text:'Half a thought'}],talkError('model server 500 at x',502)));
  observer.silenced.mockClear();observer.said.mockClear();
  await user.type(chat.getByRole('textbox'),'hello{Enter}');
  await vi.waitFor(()=>expect(chat.getByRole('button',{name:'Retry reply'})).toBeTruthy());
  expect(chat.queryByText(/Half a thought/)).toBeNull();expect(chat.getByText(/reply could not be reached/)).toBeTruthy();
  expect(observer.silenced).toHaveBeenCalledTimes(2);expect(app.animations.completeDialogueTurn).toHaveBeenCalledOnce();
  app.talk.stream.mockImplementationOnce(()=>talkStream([],talkError('talk request does not match its contract: /npc must NOT have additional properties',400)));
  await user.click(chat.getByRole('button',{name:'Retry reply'}));
  await vi.waitFor(()=>expect(chat.getByText(/refused this line/)).toBeTruthy());
  expect(chat.queryByRole('button',{name:'Retry reply'})).toBeNull();expect(chat.getByRole('textbox').disabled).toBe(false);
  expect(chat.getAllByText('hello')).toHaveLength(1);expect(app.talk.stream).toHaveBeenCalledTimes(2);expect(observer.said).not.toHaveBeenCalled();
 });

 it('greets from a passer-by without identity and says plainly that free chat is unavailable',async()=>{
  const {app,observer}=fixture();
  app.interactor.conversation={npcId:null,instance:null,behavior:null};app.presentConversation(app.interactor.conversation);
  expect(screen.getByRole('dialog',{name:'Someone passing by'})).toBeTruthy();
  const chat=within(app.view.dialog.element);
  expect(chat.queryByRole('textbox')).toBeNull();expect(chat.getByText('This passer-by has no time to chat.')).toBeTruthy();
  expect(chat.getByText('What can I do for you?').closest('.chat-line').firstElementChild.textContent).toBe('Someone passing by');
  expect(observer.said).toHaveBeenCalledOnce();
  await app.sayLine('hello');expect(app.talk.stream).not.toHaveBeenCalled();
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
