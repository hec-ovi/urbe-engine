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

function fixture( { ending = false, errand = false } = {} ) {
 const opening = step('ask', { kind:'talk', roleId:'giver', atParcelId:'p1' }, { gives:['lead'], next:[{toStepId:'visit',when:[]}] });
 opening.dialogue = { opening:'My brother never came home. Kip found something near the quay.', choices:[
  {id:'background',text:'Tell me about your brother.',reply:'[sigh] He worked the cranes. He always came home before dawn.',completesStep:false},
  {id:'accept',text:'I will find Kip and ask what he saw.',reply:'Look for him at the market. Tell him Petra sent you.',completesStep:true}
 ]};
 if (ending) { opening.next=[];opening.endingId='done'; }
 const definitions = [quest('missing_person', {roles:[role('giver','vendor')],items:[{itemId:'lead',kind:'information',name:'Kip at the market',description:'Ask Kip about the quay.'}],steps:ending?[opening]:[opening,step('visit',{kind:'goto',place:{parcelId:'p2'}},{needs:['lead'],endingId:'done'})]})];
 if (errand) {
  const letter = step('letter', { kind:'talk', roleId:'giver', atParcelId:'p1' }, { endingId:'done' });
  letter.dialogue = { opening:'Could you carry a letter for me?', choices:[{id:'carry',text:'I will take it.',reply:'Thank you.',completesStep:true}] };
  definitions.push(quest('errand', {roles:[role('giver','vendor')],steps:[letter]}));
 }
 const person=npc('person','vendor','p1');person.name={given:'Petra',family:'Moss'};
 const sim=simulation(new Map([[person.npcId,person]]));
 const log=[];const observer={said:vi.fn(heard=>log.push('said: '+heard.text)),silenced:vi.fn(()=>log.push('silenced'))};
 const app=new GameApp({},{lineObserver:observer});app.clock={timeMin:1260};app.quests=QuestSession.create(definitions,sim,1260);
 const actions=new QuestActions(app.quests);
 app.questGameplay={objective:(timeMin,questId)=>actions.objective({timeMin,...(questId?{questId}:{})})};
 app.venues={setObjective:()=>false,nameOf:()=> 'Market'};
 app.savedInventory=[];app.questItemIds=['lead'];app.input={exitLock:vi.fn(),requestLock:vi.fn()};
 app.animations={npcDialogueTurn:vi.fn(),playerDialogueTurn:vi.fn(),completeDialogueTurn:vi.fn()};
 app.talk={stream:vi.fn(()=>talkStream(replyEvents('I wish I had more to tell you.')))};
 const companion=app.companion={offers:vi.fn(()=>[]),talkOffers:vi.fn(()=>null),guide:vi.fn(()=>null),accepted:vi.fn(()=>false),accept:vi.fn(),acceptFromTool:vi.fn()};
 app.interactor={conversation:null,close:vi.fn(function(){this.conversation=null;app.presentConversation(null);})};
 const open=()=>{app.interactor.conversation={npcId:person.npcId,instance:person,behavior:null};app.presentConversation(app.interactor.conversation);};
 const state=()=>app.quests.snapshot()[0].state;
 return{app,open,state,observer,log,companion,person};
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
  const {app,open,observer,log}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  expect(chat.getByText('vendor')).toBeTruthy();expect(app.view.dialog.element.textContent).not.toMatch(/p1|working/);
  await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  await user.click(chat.getByRole('button',{name:'End conversation'}));
  open();await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  expect(log).toEqual(['said: My brother never came home. Kip found something near the quay.','silenced','said: [sigh] He worked the cranes. He always came home before dawn.','silenced',
   'said: Look for him at the market. Tell him Petra sent you.','silenced','said: Look for him at the market. Tell him Petra sent you.','silenced','said: [sigh] He worked the cranes. He always came home before dawn.']);
  for(const [heard] of observer.said.mock.calls){expect(heard.line.classList.contains('is-npc')).toBe(true);expect(heard.line.lastElementChild.textContent).toBe(heard.text.replace('[sigh] ',''));expect(heard.line.firstElementChild.textContent).toBe('Petra Moss');}
  expect(app.view.dialog.transcript.textContent).not.toContain('[sigh]');
  expect(app.animations.npcDialogueTurn).toHaveBeenCalledTimes(5);
 });

 /** Types a line whose reply shows and is heard in part, then waits until released, ignoring its abort as a slow server would. */
 async function typeHalfReply(app,chat,user){
  let release;const rest=new Promise(done=>{release=done;});
  app.talk.stream.mockImplementationOnce(()=>talkStream([{type:'delta',text:'Kip drinks. '},{type:'sentence',index:0,text:'Kip drinks.'},rest,{type:'done',reply:'Kip drinks. He sings.'}]));
  await user.type(chat.getByRole('textbox'),'where is Kip?{Enter}');
  await vi.waitFor(()=>expect(chat.getByText('Kip drinks.')).toBeTruthy());
  return async()=>{release({type:'sentence',index:1,text:'He sings.'});await new Promise(done=>setTimeout(done,0));};
 }
 function expectOvertaken(app,chat,log,said){
  expect(app.talk.stream.mock.calls.at(-1)[4].signal.aborted).toBe(true);
  expect(chat.queryByText(/Kip drinks|He sings/)).toBeNull();expect(chat.queryByText(/Waiting for a reply/)).toBeNull();
  expect(log).toEqual(['silenced','said: Kip drinks.','silenced',said]);
  expect(chat.getByRole('textbox').disabled).toBe(false);
 }

 it('lets a recap question overtake a typed reply still arriving, which leaves no line and is never heard after the silence',async()=>{
  const {app,open,log}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  await user.click(chat.getByRole('button',{name:'End conversation'}));open();log.length=0;
  const release=await typeHalfReply(app,chat,user);
  await user.click(chat.getByRole('button',{name:'Remind me what we agreed.'}));await release();
  expectOvertaken(app,chat,log,'said: Look for him at the market. Tell him Petra sent you.');
  expect([...app.view.dialog.transcript.children].slice(-2).map(line=>line.lastElementChild.textContent)).toEqual(['Remind me what we agreed.','Look for him at the market. Tell him Petra sent you.']);
 });

 it('lets a new topic overtake a typed reply still arriving, and reopening the same topic changes nothing',async()=>{
  const {app,open,log}=fixture({errand:true});open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  const topics=within(chat.getByRole('group',{name:'Conversation topics'}));log.length=0;
  const release=await typeHalfReply(app,chat,user);
  await user.click(topics.getByRole('button',{name:'missing_person'}));
  expect(app.talk.stream.mock.calls.at(-1)[4].signal.aborted).toBe(false);
  await user.click(topics.getByRole('button',{name:'errand'}));await release();
  expectOvertaken(app,chat,log,'said: Could you carry a letter for me?');
 });

 it('keeps a throwing line observer from breaking the conversation it follows',async()=>{
  const {app,open,state,observer}=fixture();const error=vi.spyOn(console,'error').mockImplementation(()=>{});
  const fail=()=>{throw new TypeError('no voice');};observer.said.mockImplementation(fail);observer.silenced.mockImplementation(fail);
  open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  expect(app.input.exitLock).toHaveBeenCalledOnce();
  await user.type(chat.getByRole('textbox'),'hello{Enter}');
  await vi.waitFor(()=>expect(chat.getByText('I wish I had more to tell you.')).toBeTruthy());
  expect(chat.queryByRole('button',{name:'Retry reply'})).toBeNull();
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  expect(state().completedStepIds).toEqual(['ask']);expect(chat.getByRole('status').textContent).toContain('Journal updated:');
  expect(error).toHaveBeenCalledWith('line observer said:',expect.any(TypeError));expect(error).toHaveBeenCalledWith('line observer silenced:',expect.any(TypeError));
 });

 const CRANES='[sigh] He worked the cranes. He always came home before dawn.',MARKET='Look for him at the market. Tell him Petra sent you.';
 it('tells an observer that listens for them which replies each newly opened topic may bring, once per topic',async()=>{
  const {app,open,observer}=fixture({errand:true});observer.upcoming=vi.fn();open();
  const user=userEvent.setup();const chat=within(app.view.dialog.element);const topics=within(chat.getByRole('group',{name:'Conversation topics'}));
  expect(observer.upcoming).toHaveBeenCalledExactlyOnceWith({conversation:app.interactor.conversation,texts:[CRANES,MARKET]});
  await user.click(topics.getByRole('button',{name:'missing_person'}));
  await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  expect(observer.upcoming).toHaveBeenCalledOnce();
  await user.click(topics.getByRole('button',{name:'errand'}));
  expect(observer.upcoming).toHaveBeenLastCalledWith({conversation:app.interactor.conversation,texts:['Thank you.']});
  expect(observer.upcoming).toHaveBeenCalledTimes(2);
 });

 it('tells the observer which replies a recap\'s questions may bring, and logs what it rejects with',async()=>{
  const {app,open,observer}=fixture();const error=vi.spyOn(console,'error').mockImplementation(()=>{});open();
  const user=userEvent.setup();const chat=within(app.view.dialog.element);
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  await user.click(chat.getByRole('button',{name:'End conversation'}));
  observer.upcoming=vi.fn(async()=>{throw new Error('no prefetch');});open();
  expect(observer.upcoming).toHaveBeenCalledExactlyOnceWith({conversation:app.interactor.conversation,texts:[CRANES]});
  await vi.waitFor(()=>expect(error).toHaveBeenCalledWith('line observer upcoming:',expect.objectContaining({message:'no prefetch'})));
  expect(chat.getByText(/Look for him at the market/)).toBeTruthy();
 });

 const OFFERS=[
  {offerId:'follow',kind:'follow',label:'Come with me',available:false,reason:'on_duty'},
  {offerId:'lead:parcel:p2',kind:'lead',label:'Show me Market',available:true,destination:{place:{kind:'parcel',id:'p2'},name:'Market',relation:'quest'}}
 ];
 const lines=(app)=>[...app.view.dialog.transcript.children].map(line=>line.lastElementChild.textContent);

 it('streams a typed reply into one growing line heard by sentence, carrying what the person may propose, and sets off with a person who agrees',async()=>{
  const {app,open,state,observer,log,companion}=fixture();companion.offers.mockReturnValue(OFFERS);
  companion.talkOffers.mockReturnValue({places:[{placeId:'p2',name:'Market'}]});
  companion.acceptFromTool.mockImplementation(()=>{companion.accepted.mockReturnValue(true);return{ok:true,npcId:'person',offerId:'lead:parcel:p2',kind:'lead',line:'Follow me to Market.'};});
  open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  expect(within(chat.getByRole('group',{name:'Suggested actions'})).getAllByRole('button').map(button=>button.textContent)).toEqual(['Come with me','Show me Market']);
  expect(companion.offers).toHaveBeenLastCalledWith({npcId:'person',timeMin:1260,playerPlaces:[]});
  let release;const rest=new Promise(done=>{release=done;});
  app.talk.stream.mockImplementationOnce(()=>talkStream([{type:'delta',text:'Kip drinks '},rest,{type:'sentence',index:0,text:'Kip drinks [sigh] at the market.'},
   {type:'offer',kind:'lead',placeId:'p2',name:'Market'},{type:'offer',kind:'follow'},{type:'done',reply:'Kip drinks [sigh] at the market.'}]));
  const initial=structuredClone(state());observer.said.mockClear();
  await user.type(chat.getByRole('textbox'),'take me to Kip{Enter}');
  expect(app.talk.stream.mock.calls.at(-1)[4]).toEqual({signal:expect.any(AbortSignal),offers:{places:[{placeId:'p2',name:'Market'}]}});
  await vi.waitFor(()=>expect(chat.getByText('Kip drinks')).toBeTruthy());
  expect(chat.getByRole('textbox').disabled).toBe(true);expect(chat.queryByText(/Waiting for a reply/)).toBeNull();
  expect(observer.said).not.toHaveBeenCalled();expect(companion.acceptFromTool).not.toHaveBeenCalled();
  release({type:'delta',text:'[sigh] at the market.'});
  await vi.waitFor(()=>expect(app.interactor.conversation).toBeNull());
  expect(observer.said).toHaveBeenCalledExactlyOnceWith({conversation:expect.objectContaining({npcId:'person'}),line:expect.any(HTMLElement),text:'Kip drinks [sigh] at the market.'});
  expect(companion.acceptFromTool).toHaveBeenCalledExactlyOnceWith({npcId:'person',kind:'lead',placeId:'p2',timeMin:1260,playerPlaces:[]});
  expect(app.interactor.close).toHaveBeenCalledExactlyOnceWith(app.clock,'player-left',{keep:true});
  expect(app.view.dialog.element.hidden).toBe(true);
  expect(app.view.toast.element.textContent).toBe('Petra MossKip drinks at the market.');
  // The person goes on saying it as they set off: the close silences nothing.
  expect(log.at(-1)).toBe('said: Kip drinks [sigh] at the market.');
  expect(state()).toEqual(initial);
 });

 it('answers a chat action by the companion rules: a refusal is said in the chat, an agreement closes it on the person\'s words and keeps them there',async()=>{
  const {app,open,log,companion}=fixture();companion.offers.mockReturnValue(OFFERS);open();
  const user=userEvent.setup();const chat=within(app.view.dialog.element);const actions=()=>within(chat.getByRole('group',{name:'Suggested actions'}));
  companion.accept.mockReturnValueOnce({ok:false,npcId:'person',code:'on_duty',line:'I\'m working. Not now.'});
  await user.click(actions().getByRole('button',{name:'Come with me'}));
  expect(companion.accept).toHaveBeenLastCalledWith({npcId:'person',offerId:'follow',timeMin:1260,playerPlaces:[]});
  expect(lines(app).slice(-2)).toEqual(['Come with me','I\'m working. Not now.']);
  expect(app.view.dialog.element.hidden).toBe(false);expect(actions().getAllByRole('button')).toHaveLength(2);

  // A typed agreement the rules refuse is said too, and the chat stays open.
  app.talk.stream.mockImplementationOnce(()=>talkStream([...replyEvents('Sure, this way.').slice(0,-1),{type:'offer',kind:'follow'},{type:'done',reply:'Sure, this way.'}]));
  companion.acceptFromTool.mockReturnValueOnce({ok:false,npcId:'person',code:'on_duty',line:'My shift isn\'t over.'});
  await user.type(chat.getByRole('textbox'),'come with me{Enter}');
  await vi.waitFor(()=>expect(chat.getByText('My shift isn\'t over.')).toBeTruthy());
  expect(app.interactor.conversation).not.toBeNull();

  companion.accept.mockImplementationOnce(()=>{companion.accepted.mockReturnValue(true);return{ok:true,npcId:'person',offerId:'lead:parcel:p2',kind:'lead',line:'Follow me to Market.'};});
  log.length=0;
  await user.click(actions().getByRole('button',{name:'Show me Market'}));
  expect(app.interactor.close).toHaveBeenCalledExactlyOnceWith(app.clock,'player-left',{keep:true});
  expect(app.view.dialog.element.hidden).toBe(true);expect(app.view.toast.element.textContent).toContain('Petra MossFollow me to Market.');
  expect(log).toEqual(['silenced','said: Follow me to Market.']);
 });

 it('lets a person who has led the player here talk about the place unasked, and say their own line when the model cannot',async()=>{
  const {app,log,companion,person}=fixture();app.quests.dialoguesFor=()=>[];
  const guide={placeId:'p2',kind:'parcel',name:'Market'};companion.guide.mockReturnValue(guide);
  // The arrival's question is not the player's words: it proposes nothing.
  companion.talkOffers.mockReturnValue({follow:true});
  const arrival={kind:'arrival',npcId:'person',guide,relation:'quest',ask:'So this is Market. Tell me about it.',line:'Here it is: Market.'};
  // As Interactor.talkTo opens it while the arrival is handled.
  const talk=(signal)=>{app.arriving=signal;app.interactor.conversation={npcId:person.npcId,instance:person,behavior:null};app.presentConversation(app.interactor.conversation);app.arriving=null;};
  app.talk.stream.mockImplementationOnce(()=>talkStream(replyEvents('The market never sleeps.')));
  talk(arrival);
  await vi.waitFor(()=>expect(lines(app)).toEqual(['The market never sleeps.']));
  expect(app.talk.stream.mock.calls.at(-1).slice(1,3)).toEqual(['So this is Market. Tell me about it.',1260]);
  expect(app.talk.stream.mock.calls.at(-1)[4]).toEqual({signal:expect.any(AbortSignal),guide});
  app.interactor.close();log.length=0;

  app.talk.stream.mockImplementationOnce(()=>talkStream([],talkError('model unavailable',502)));
  talk(arrival);
  await vi.waitFor(()=>expect(lines(app)).toEqual(['Here it is: Market.']));
  expect(within(app.view.dialog.element).queryByRole('button',{name:'Retry reply'})).toBeNull();
  expect(log).toEqual(['said: Here it is: Market.']);
 });

 it('drops a failed half reply, silencing what was heard of it, and offers Retry, but says a refused line cannot be retried',async()=>{
  const {app,open,log}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  app.talk.stream.mockImplementationOnce(()=>talkStream([{type:'delta',text:'Half a thought. '},{type:'sentence',index:0,text:'Half a thought.'}],talkError('model server 500 at x',502)));
  log.length=0;
  await user.type(chat.getByRole('textbox'),'hello{Enter}');
  await vi.waitFor(()=>expect(chat.getByRole('button',{name:'Retry reply'})).toBeTruthy());
  expect(chat.queryByText(/Half a thought/)).toBeNull();expect(chat.getByText(/reply could not be reached/)).toBeTruthy();
  expect(log).toEqual(['silenced','said: Half a thought.','silenced']);expect(app.animations.completeDialogueTurn).toHaveBeenCalledOnce();
  app.talk.stream.mockImplementationOnce(()=>talkStream([],talkError('talk request does not match its contract: /npc must NOT have additional properties',400)));
  await user.click(chat.getByRole('button',{name:'Retry reply'}));
  await vi.waitFor(()=>expect(chat.getByText(/refused this line/)).toBeTruthy());
  expect(chat.queryByRole('button',{name:'Retry reply'})).toBeNull();expect(chat.getByRole('textbox').disabled).toBe(false);
  expect(chat.getAllByText('hello')).toHaveLength(1);expect(app.talk.stream).toHaveBeenCalledTimes(2);expect(log).toHaveLength(3);
 });

 it('lets a passer-by without identity brush the player off, and says plainly that free chat is unavailable',async()=>{
  const {app,observer}=fixture();
  app.interactor.conversation={npcId:null,instance:null,behavior:null};app.presentConversation(app.interactor.conversation);
  expect(screen.getByRole('dialog',{name:'Someone passing by'})).toBeTruthy();
  const chat=within(app.view.dialog.element);
  expect(chat.queryByRole('textbox')).toBeNull();expect(chat.getByText('This passer-by has no time to chat.')).toBeTruthy();
  expect(chat.getByText('Sorry, I can\'t stop.').closest('.chat-line').firstElementChild.textContent).toBe('Someone passing by');
  expect(observer.said).toHaveBeenCalledOnce();
  await app.sayLine('hello');expect(app.talk.stream).not.toHaveBeenCalled();
 });

 it('shows an ending after the final reply is read, and Continue closes the outcome and returns control',async()=>{
  const {app,open,state}=fixture({ending:true});open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
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
