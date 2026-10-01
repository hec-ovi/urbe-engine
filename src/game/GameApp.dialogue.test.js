// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { Vector3 } from 'three';
import { GameApp, lightWords } from './GameApp.js';
import { describeLook } from './agents/avatar/Describe.js';
import { recipeFor } from './agents/Appearance.js';
import { QuestSession } from './quests/QuestSession.js';
import { QuestActions } from './quests/QuestActions.js';
import { GameClock } from './time/GameClock.js';
import { HitchLog } from './debug/HitchLog.js';
import { npc, quest, role, simulation, step } from './quests/quest.test-fixtures.js';
import { replyEvents, talkError, talkStream } from './talk/talk.test-fixtures.js';
import { TalkClient } from './talk/TalkClient.js';
import { RecentEvents } from './talk/RecentEvents.js';

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
 app.sim=sim;app.hitches=new HitchLog();
 const actions=new QuestActions(app.quests);
 app.questGameplay={objective:(timeMin,questId)=>actions.objective({timeMin,...(questId?{questId}:{})}),characterName:()=>null};
 app.venues={setObjective:()=>false,nameOf:()=> 'Market'};
 app.savedInventory=[];app.questItemIds=['lead'];app.input={exitLock:vi.fn(),requestLock:vi.fn()};
 app.animations={npcDialogueTurn:vi.fn(),playerDialogueTurn:vi.fn(),completeDialogueTurn:vi.fn()};
 app.talk={stream:vi.fn(()=>talkStream(replyEvents('I wish I had more to tell you.'))),said:vi.fn(),remembered:vi.fn(async()=>[])};
 const companion=app.companion={offers:vi.fn(()=>[]),talkOffers:vi.fn(()=>null),guide:vi.fn(()=>null),accepted:vi.fn(()=>false),accept:vi.fn(),acceptFromTool:vi.fn()};
 app.scenery={refresh:vi.fn(),stagedPlaces:vi.fn(()=>[])};
 app.body={feet:{x:0,y:0,z:0}};app.crowd={member:vi.fn(()=>null)};
 app.recentEvents=new RecentEvents([{id:'p1',access:{point:[0,0]}},{id:'p2',access:{point:[60,0]}}]);
 // As Interactor.talkTo: the person's body, while it has one, opens a conversation when none is open.
 app.interactor={conversation:null,close:vi.fn(function(){this.conversation=null;app.presentConversation(null);}),
  talkTo:vi.fn(function(npcId){if(this.conversation||person.gone)return null;this.conversation={npcId,instance:person,behavior:null};app.presentConversation(this.conversation);return this.conversation;})};
 // The player opens the talk window to talk freely; the story replies stay where they are.
 const open=()=>{app.interactor.conversation={npcId:person.npcId,instance:person,behavior:null};app.presentConversation(app.interactor.conversation);app.view.dialog.setTalkOpen(true);};
 const state=()=>app.quests.snapshot()[0].state;
 return{app,open,state,observer,log,companion,person};
}

/** The transcript alone: the subtitle repeats its newest line. */
const said=(app)=>within(app.view.dialog.transcript);

beforeEach(()=>{document.body.replaceChildren();stubCanvas();vi.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('explicit quest dialogue through the playable UI',()=>{
 it('keeps questions and goodbye noncommitting, advances one chosen reply, and updates the same journal, HUD and scenery',async()=>{
  const {app,open,state}=fixture();const user=userEvent.setup();
  // The talk client itself, over a server that answers every line alike.
  const bodies=[];vi.stubGlobal('fetch',async(_url,init)=>{bodies.push(JSON.parse(init.body));
   return new Response(replyEvents('I wish I had more to tell you.').map(event=>JSON.stringify(event)+'\n').join(''));});
  app.talk=new TalkClient('/out/t');vi.spyOn(app.talk,'said');open();
  const chat=within(app.view.dialog.element);
  expect(said(app).getByText(/My brother never came home/)).toBeTruthy();
  expect(said(app).getByText(/My brother never came home/).closest('.chat-line').dataset.tag).toBe('story');
  // The talk opens on its scene, and the story says why it matters, not to talk to the person already talked to.
  expect(said(app).getByText('ask completed.').closest('.chat-line').nextElementSibling.textContent).toContain('My brother never came home');
  expect(said(app).getByText('ask completed.').closest('.chat-line').classList.contains('is-scene')).toBe(true);
  expect(chat.getByText('The objective remains unresolved otherwise.').previousElementSibling.textContent).toBe('Why it matters');
  expect(chat.queryByText('Complete ask.')).toBeNull();
  // Only the reply that completes the step is marked as moving the story on.
  expect(chat.getByRole('button',{name:'I will find Kip and ask what he saw.',description:'Moves the story on'})).toBeTruthy();
  expect(chat.getByRole('button',{name:'Tell me about your brother.'}).getAttribute('aria-describedby')).toBeNull();
  expect(chat.queryByText(/working @ parcel/)).toBeNull();
  const initial=structuredClone(state());
  await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  expect(said(app).getByText(/He worked the cranes/)).toBeTruthy();expect(state()).toEqual(initial);
  await user.click(chat.getByRole('button',{name:'End conversation'}));expect(state()).toEqual(initial);
  open();await user.type(chat.getByRole('textbox',{name:'say something'}),'hello{Enter}');
  await vi.waitFor(()=>expect(said(app).getByText('I wish I had more to tell you.')).toBeTruthy());expect(state()).toEqual(initial);
  // Every line shown goes with the next typed one, raw and once, at its minute; the typed line and its streamed reply travel on their own.
  const opening='My brother never came home. Kip found something near the quay.';
  expect(app.talk.said.mock.calls).toEqual([['person','npc',opening,1260],['person','player','Tell me about your brother.',1260],
   ['person','npc',CRANES,1260],['person','npc',opening,1260]]);
  expect(bodies.map(body=>[body.line,body.prior])).toEqual([['hello',[{speaker:'npc',text:opening,atMin:1260},
   {speaker:'player',text:'Tell me about your brother.',atMin:1260},{speaker:'npc',text:CRANES,atMin:1260}]]]);
  expect(app.scenery.refresh).not.toHaveBeenCalled();
  const choice=chat.getByRole('button',{name:'I will find Kip and ask what he saw.'});await user.click(choice);choice.click();
	 expect(document.activeElement).toBe(chat.getByRole('button',{name:'End conversation'}));
  expect(state().completedStepIds).toEqual(['ask']);expect(state().activeStepIds).toEqual(['visit']);
  expect(app.scenery.refresh).toHaveBeenCalledExactlyOnceWith(1260);
  expect(app.quests.inventoryView()).toHaveLength(1);
  expect(said(app).getByText(/Look for him at the market/)).toBeTruthy();
  expect(chat.getByRole('status').textContent).toBe('Journal updated.');
  expect(chat.getByText('Complete visit.').previousElementSibling.textContent).toBe('Your goal');
  expect(app.view.objective.element.textContent).toContain('visit');
  expect(app.view.quests.quests[0].steps.find(s=>s.stepId==='visit').state).toBe('active');
  await user.click(chat.getByRole('button',{name:'End conversation'}));expect(state().completedStepIds).toEqual(['ask']);
  open();expect(said(app).getByText(/Look for him at the market/)).toBeTruthy();
  await user.click(chat.getByRole('button',{name:'Tell me about your brother.'}));
  expect(said(app).getByText(/He worked the cranes/)).toBeTruthy();expect(state().completedStepIds).toEqual(['ask']);
 });

 it('serializes typed requests, discards late replies, and keeps offline story choices usable',async()=>{
  const {app,open,state}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  let resolve;app.talk.stream.mockImplementationOnce(()=>talkStream([new Promise(done=>{resolve=done;})]));
  await user.type(chat.getByRole('textbox'),'hello{Enter}');
  expect(chat.getByRole('textbox').disabled).toBe(true);
  expect(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}).disabled).toBe(false);
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  resolve({type:'delta',text:'This delayed reply must not replace the new lead.'});await new Promise(done=>setTimeout(done,0));
  expect(said(app).queryByText(/This delayed reply/)).toBeNull();expect(state().completedStepIds).toEqual(['ask']);
  app.talk.stream.mockImplementationOnce(()=>talkStream([],new Error('offline')));
  await user.type(chat.getByRole('textbox'),'thanks{Enter}');
  await vi.waitFor(()=>expect(chat.getByRole('button',{name:'Retry reply'})).toBeTruthy());
  expect(said(app).queryByText('...')).toBeNull();
  const count=said(app).getAllByText('thanks').length;await user.click(chat.getByRole('button',{name:'Retry reply'}));
  await vi.waitFor(()=>expect(said(app).getByText('I wish I had more to tell you.')).toBeTruthy());
  expect(said(app).getAllByText('thanks')).toHaveLength(count);expect(state().completedStepIds).toEqual(['ask']);
 });
 it('passes every NPC line through one speaking turn and the line observer, silenced whenever the player takes the turn',async()=>{
  const {app,open,observer,log}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  expect(app.view.dialog.role.textContent).toBe('vendor');expect(app.view.dialog.element.textContent).not.toMatch(/p1|working/);
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
  await vi.waitFor(()=>expect(said(app).getByText('Kip drinks.')).toBeTruthy());
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
  const topics=within(chat.getByRole('group',{name:'Topics'}));log.length=0;
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
  await vi.waitFor(()=>expect(said(app).getByText('I wish I had more to tell you.')).toBeTruthy());
  expect(chat.queryByRole('button',{name:'Retry reply'})).toBeNull();
  await user.click(chat.getByRole('button',{name:'I will find Kip and ask what he saw.'}));
  expect(state().completedStepIds).toEqual(['ask']);expect(chat.getByRole('status').textContent).toBe('Journal updated.');
  expect(error).toHaveBeenCalledWith('line observer said:',expect.any(TypeError));expect(error).toHaveBeenCalledWith('line observer silenced:',expect.any(TypeError));
 });

 const CRANES='[sigh] He worked the cranes. He always came home before dawn.',MARKET='Look for him at the market. Tell him Petra sent you.';
 it('tells an observer that listens for them which replies each newly opened topic may bring, once per topic',async()=>{
  const {app,open,observer}=fixture({errand:true});observer.upcoming=vi.fn();open();
  const user=userEvent.setup();const chat=within(app.view.dialog.element);const topics=within(chat.getByRole('group',{name:'Topics'}));
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
  expect(said(app).getByText(/Look for him at the market/)).toBeTruthy();
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
  expect(within(chat.getByRole('group',{name:'Ask Petra Moss along'})).getAllByRole('button').map(button=>button.textContent)).toEqual(['Come with me','Show me Market']);
  expect(companion.offers).toHaveBeenLastCalledWith({npcId:'person',timeMin:1260,playerPlaces:[]});
  let release;const rest=new Promise(done=>{release=done;});
  app.talk.stream.mockImplementationOnce(()=>talkStream([{type:'delta',text:'Kip drinks '},rest,{type:'sentence',index:0,text:'Kip drinks [sigh] at the market.'},
   {type:'offer',kind:'lead',placeId:'p2',name:'Market'},{type:'offer',kind:'follow'},{type:'done',reply:'Kip drinks [sigh] at the market.'}]));
  const initial=structuredClone(state());observer.said.mockClear();
  await user.type(chat.getByRole('textbox'),'take me to Kip{Enter}');
  expect(app.talk.stream.mock.calls.at(-1)[4]).toEqual({signal:expect.any(AbortSignal),offers:{places:[{placeId:'p2',name:'Market'}]}});
  await vi.waitFor(()=>expect(said(app).getByText('Kip drinks')).toBeTruthy());
  expect(chat.getByRole('textbox').disabled).toBe(true);expect(chat.queryByText(/Waiting for a reply/)).toBeNull();
  expect(observer.said).not.toHaveBeenCalled();expect(companion.acceptFromTool).not.toHaveBeenCalled();
  release({type:'delta',text:'[sigh] at the market.'});
  await vi.waitFor(()=>expect(app.interactor.conversation).toBeNull());
  expect(observer.said).toHaveBeenCalledExactlyOnceWith({conversation:expect.objectContaining({npcId:'person'}),line:expect.any(HTMLElement),text:'Kip drinks [sigh] at the market.'});
  expect(companion.acceptFromTool).toHaveBeenCalledExactlyOnceWith({npcId:'person',kind:'lead',placeId:'p2',timeMin:1260,playerPlaces:[]});
  expect(app.interactor.close).toHaveBeenCalledExactlyOnceWith(app.clock,'player-left',{keep:true});
  expect(app.view.dialog.element.hidden).toBe(true);
  expect(app.view.toast.element.querySelector('.toast-title').textContent).toBe('Petra Moss');
  expect(app.view.toast.element.querySelector('.toast-text').textContent).toBe('Kip drinks at the market.');
  // The person goes on saying it as they set off: the close silences nothing.
  expect(log.at(-1)).toBe('said: Kip drinks [sigh] at the market.');
  expect(state()).toEqual(initial);
 });

 it('shows what the person remembers saying with the player above a conversation that opens again, and nothing of it once another has opened',async()=>{
  const {app,open}=fixture();app.quests.dialoguesFor=()=>[];
  app.talk.remembered.mockResolvedValueOnce([{speaker:'player',text:'Where is Kip?',atMin:1200},{speaker:'npc',text:'At the market, most nights.',atMin:1200}]);
  open();
  await vi.waitFor(()=>expect(lines(app)).toEqual(['Where is Kip?','At the market, most nights.']));
  expect(app.talk.remembered).toHaveBeenCalledExactlyOnceWith('person');
  const earlier=[...app.view.dialog.transcript.children].filter(line=>line.classList.contains('is-earlier'));
  expect(earlier.map(line=>line.firstElementChild.textContent)).toEqual(['You','Petra Moss']);
  expect(app.talk.said).not.toHaveBeenCalledWith('person',expect.anything(),'Where is Kip?',expect.anything());
  // Memory that arrives after its conversation closed shows nowhere.
  let answer;app.talk.remembered.mockReturnValueOnce(new Promise(done=>{answer=done;}));
  app.interactor.close();open();app.interactor.close();
  answer([{speaker:'npc',text:'Late.',atMin:1200}]);await new Promise(done=>setTimeout(done,0));
  expect(app.view.dialog.transcript.textContent).not.toContain('Late.');
 });

 it('tells a typed talk what happened around the person: a car that hit someone nearby, still down, and a scene in the street',async()=>{
  const {app,open}=fixture();app.quests.dialoguesFor=()=>[];open();
  app.recentEvents.struck({personId:'crowd-7',point:{x:4,y:1,z:3},hard:true,atMin:1250});
  app.recentEvents.struck({personId:'crowd-8',point:{x:900,y:1,z:0},atMin:1255});
  app.crowd.member.mockImplementation(id=>id==='crowd-7'?{fallen:true}:null);
  const notes=['It looks like a crime scene.'];
  app.scenery.stagedPlaces.mockReturnValue([{sceneId:'s',place:{parcelId:'p2'},frame:{kind:'street',origin:{x:58,y:0,z:4}},stagedAtMin:1200,notes}]);
  await userEvent.setup().type(within(app.view.dialog.element).getByRole('textbox'),'What happened?{Enter}');
  await vi.waitFor(()=>expect(app.talk.stream).toHaveBeenCalled());
  expect(app.talk.stream.mock.calls.at(-1)[4].events).toEqual([
   {kind:'struck',atMin:1250,parcelId:'p1',metres:5,hard:true,down:true},
   {kind:'scene',atMin:1200,parcelId:'p2',metres:58,notes}
  ]);
 });

 it('tells a talk to a body what the person looks like, where they stand and who they know, the one the player names seen here',async()=>{
  const {app,person}=fixture();app.quests.dialoguesFor=()=>[];
  const kip=npc('kip','vendor','p1');kip.name={given:'Kip',family:'Ash'};kip.job.shift={startMin:480,endMin:960,days:[0,1,2,3,4],kind:'day'};
  app.sim.people.set(kip.npcId,kip);app.sim.findNPCs=()=>[...app.sim.people.values()];
  app.sky={day:{state:'night'}};
  const lobby={parcelId:'p1',floor:0,kind:'lobby',holds:()=>true};app.stream={rooms:[lobby]};
  app.interiorRoutes={plan:id=>id==='p1'?{floors:[{index:0,lifts:[{id:'elev-0'}],stairs:[{id:'stair-a'}],rooms:[{kind:'lobby'}]},{index:1,lifts:[{id:'elev-0'}],stairs:[{id:'stair-a'}],rooms:[]}],apartments:[{floor:1,number:'101'}]}:null};
  app.crowd.members=new Map([['c1',{npcId:kip.npcId,parcelId:'p1',position:new Vector3(3,0,0)}]]);
  app.interactor.conversation={npcId:person.npcId,instance:person,behavior:null,person:{position:new Vector3(1,0,2),parcelId:'p1'}};
  app.presentConversation(app.interactor.conversation);app.view.dialog.setTalkOpen(true);
  await userEvent.setup().type(within(app.view.dialog.element).getByRole('textbox'),'Is Kip around?{Enter}');
  await vi.waitFor(()=>expect(app.talk.stream).toHaveBeenCalled());
  const context=app.talk.stream.mock.calls.at(-1)[4];
  expect(context.look).toEqual(describeLook(recipeFor({gender:person.gender,appearanceSeed:person.appearanceSeed,npcId:person.npcId}).recipe));
  expect(context.here).toEqual({x:1,z:2,parcelId:'p1',floor:0,light:lightWords('night',true),building:{
   floors:[{index:0,rooms:['lobby']},{index:1,rooms:[],apartments:['101']}],lifts:1,stairs:1,room:'lobby',
   people:[{name:'Kip Ash',role:'vendor',floor:0,room:'lobby'}]
  }});
  expect(context.people.known).toEqual([expect.objectContaining({npcId:kip.npcId,relation:'coworker',now:{kind:'here'},asked:true})]);
  expect(context.people.unknown).toEqual([]);
 });

 it('tells a talk of a car that hit someone once the fall is taken, and the person who stood by it wherever they talk later',async()=>{
  const {app,open}=fixture();app.quests.dialoguesFor=()=>[];
  // The person talked to stood 7 m from the impact; a refused fall is no news.
  const members=new Map([['crowd-7',{id:'crowd-7',npcId:'walker',position:{x:4,y:0,z:3},fallen:false}],['crowd-9',{id:'crowd-9',npcId:'person',position:{x:10,y:0,z:0},fallen:false}]]);
  app.crowd={members,member:id=>members.get(id)??null,beginRagdoll:id=>Object.assign(members.get(id),{fallen:true}),cancelRagdoll:id=>Object.assign(members.get(id),{fallen:false})};
  Object.assign(app.animations,{physicsInterrupt:vi.fn(),physicsResume:vi.fn()});
  app.impactWorld={release:vi.fn()};app.questGameplay.fatalImpact=vi.fn(()=>null);app.hero={fall:vi.fn(async()=>false)};
  const impact={personId:'crowd-7',vehicleId:'car-1',impactSpeed:14,fatal:true,point:{x:4,y:1.05,z:3},impulse:{x:0,y:10,z:14}};
  const talk=async(line)=>{const count=app.talk.stream.mock.calls.length;
   await userEvent.setup().type(within(app.view.dialog.element).getByRole('textbox'),`${line}{Enter}`);
   await vi.waitFor(()=>expect(app.talk.stream).toHaveBeenCalledTimes(count+1));
   await vi.waitFor(()=>expect(app.dialoguePending).toBe(false));return app.talk.stream.mock.calls.at(-1)[4].events;};
  app.ragdoll(impact);await vi.waitFor(()=>expect(app.impactWorld.release).toHaveBeenCalledWith('crowd-7'));
  expect(members.get('crowd-7').fallen).toBe(false);
  open();expect(await talk('Anything happen?')).toBeUndefined();
  // Taken, it is news to the leader 200 m on, with the body still down, and the person hit knows it was them.
  app.hero.fall.mockResolvedValueOnce(true);app.ragdoll(impact);
  await vi.waitFor(()=>expect(app.questGameplay.fatalImpact).toHaveBeenCalledWith(impact,'walker',1260));
  app.body.feet={x:200,y:0,z:0};
  expect(await talk('Anything happen?')).toEqual([{kind:'struck',atMin:1260,parcelId:'p1',metres:196,hard:true,down:true}]);
  expect(app.recentEvents.around({position:app.body.feet,timeMin:1260,npcId:'walker'})).toEqual([{kind:'struck',atMin:1260,parcelId:'p1',metres:196,hard:true,self:true}]);
 });

 it('answers a chat action by the companion rules, or as the person decides in a talk that asks it alone: a refusal is said in the chat, an agreement closes it on the person\'s words and keeps them there',async()=>{
  const {app,open,log,companion}=fixture();companion.offers.mockReturnValue(OFFERS);open();
  const user=userEvent.setup();const chat=within(app.view.dialog.element);const actions=()=>within(chat.getByRole('group',{name:'Ask Petra Moss along'}));
  companion.accept.mockReturnValueOnce({ok:false,npcId:'person',code:'on_duty',line:'I\'m working. Not now.'});
  await user.click(actions().getByRole('button',{name:'Come with me'}));
  expect(companion.accept).toHaveBeenLastCalledWith({npcId:'person',offerId:'follow',timeMin:1260,playerPlaces:[]});
  expect(lines(app).slice(-2)).toEqual(['Come with me','I\'m working. Not now.']);
  expect(app.view.dialog.element.hidden).toBe(false);expect(actions().getAllByRole('button')).toHaveLength(2);

  // A typed agreement the rules refuse is said too, and the chat stays open.
  app.talk.stream.mockImplementationOnce(()=>talkStream([...replyEvents('Sure, this way.').slice(0,-1),{type:'offer',kind:'follow'},{type:'done',reply:'Sure, this way.'}]));
  companion.acceptFromTool.mockReturnValueOnce({ok:false,npcId:'person',code:'on_duty',line:'My shift isn\'t over.'});
  await user.type(chat.getByRole('textbox'),'come with me{Enter}');
  await vi.waitFor(()=>expect(said(app).getByText('My shift isn\'t over.')).toBeTruthy());
  expect(app.interactor.conversation).not.toBeNull();

  // An action the rules allow is the person's own decision, asked in a talk that offers that alone.
  companion.talkOffers.mockImplementation((offers)=>offers.length===1?{places:[{placeId:'p2',name:'Market'}]}:null);
  app.talk.stream.mockImplementationOnce(()=>talkStream([...replyEvents('Follow me to Market.').slice(0,-1),{type:'offer',kind:'lead',placeId:'p2',name:'Market'},{type:'done',reply:'Follow me to Market.'}]));
  companion.acceptFromTool.mockImplementationOnce(()=>{companion.accepted.mockReturnValue(true);return{ok:true,npcId:'person',offerId:'lead:parcel:p2',kind:'lead',line:'Follow me.'};});
  await user.click(actions().getByRole('button',{name:'Show me Market'}));
  await vi.waitFor(()=>expect(app.interactor.close).toHaveBeenCalledExactlyOnceWith(app.clock,'player-left',{keep:true}));
  expect(app.talk.stream.mock.calls.at(-1)[1]).toBe('Show me Market');
  expect(app.talk.stream.mock.calls.at(-1)[4].offers).toEqual({places:[{placeId:'p2',name:'Market'}]});
  expect(companion.talkOffers).toHaveBeenLastCalledWith([OFFERS[1]]);
  expect(app.view.dialog.element.hidden).toBe(true);expect(app.view.toast.element.textContent).toContain('Petra MossFollow me to Market.');
 });

 it('decides a chosen action by the person\'s disposition when nobody can answer for them',async()=>{
  const {app,open,companion}=fixture();companion.offers.mockReturnValue(OFFERS);open();
  app.talk.stream.mockImplementationOnce(()=>talkStream([],talkError('model unavailable',502)));
  companion.accept.mockReturnValueOnce({ok:false,npcId:'person',code:'unwilling',line:'I don\'t know you. No.'});
  await userEvent.setup().click(within(within(app.view.dialog.element).getByRole('group',{name:'Ask Petra Moss along'})).getByRole('button',{name:'Show me Market'}));
  await vi.waitFor(()=>expect(companion.accept).toHaveBeenCalledWith({npcId:'person',offerId:'lead:parcel:p2',timeMin:1260,playerPlaces:[],willing:true}));
  expect(lines(app).slice(-2)).toEqual(['Show me Market','I don\'t know you. No.']);
  expect(app.view.dialog.element.hidden).toBe(false);
 });

 const GUIDE={placeId:'p2',kind:'parcel',name:'Market'};
 const ARRIVAL={kind:'arrival',npcId:'person',guide:GUIDE,relation:'quest',ask:'So this is Market. Tell me about it.',line:'Here it is: Market.'};
 /** One companion frame reporting `signals`, as tick runs it; returns what the companion was asked. */
 const frame=(app,...signals)=>{app.companion.update=vi.fn(()=>signals);app.updateCompanion([4,0,2],[]);return app.companion.update.mock.calls[0][0];};
 const toasts=(app)=>[...app.view.toast.element.children].map(toast=>toast.querySelector('.toast-title').textContent+toast.querySelector('.toast-text').textContent);

 it('opens the talk by itself when a leader arrives: the person talks about the place unasked, or says their own line when the model cannot',async()=>{
  const {app,log,companion}=fixture();app.quests.dialoguesFor=()=>[];companion.guide.mockReturnValue(GUIDE);
  // The arrival's question is not the player's words: it proposes nothing.
  companion.talkOffers.mockReturnValue({follow:true});
  app.talk.stream.mockImplementationOnce(()=>talkStream(replyEvents('The market never sleeps.')));
  expect(frame(app,ARRIVAL)).toEqual({timeMin:1260,playerPosition:[4,0,2],playerPlaces:[],busy:false});
  expect(app.interactor.talkTo).toHaveBeenCalledExactlyOnceWith('person',app.clock);expect(app.arriving).toBeNull();
  await vi.waitFor(()=>expect(lines(app)).toEqual(['The market never sleeps.']));
  expect(app.talk.stream.mock.calls.at(-1).slice(1,3)).toEqual(['So this is Market. Tell me about it.',1260]);
  expect(app.talk.stream.mock.calls.at(-1)[4]).toEqual({signal:expect.any(AbortSignal),guide:GUIDE});
  expect(toasts(app)).toEqual([]);
  app.interactor.close();log.length=0;

  app.talk.stream.mockImplementationOnce(()=>talkStream([],talkError('model unavailable',502)));
  frame(app,ARRIVAL);
  await vi.waitFor(()=>expect(lines(app)).toEqual(['Here it is: Market.']));
  expect(within(app.view.dialog.element).queryByRole('button',{name:'Retry reply'})).toBeNull();
  expect(log).toEqual(['said: Here it is: Market.']);
 });

 it('says the companion\'s words outside a conversation as toasts heard with no chat line, holds the arrival while anything is open, and shows a notice when it ends',()=>{
  const {app,open,log,observer,person}=fixture();
  // Nothing is said over a conversation, and the companion hears the player is busy.
  open();log.length=0;
  expect(frame(app,{kind:'line',npcId:'person',line:'This way.'},{kind:'refused',npcId:'person',line:'I cannot come.'})).toMatchObject({busy:true});
  expect(log).toEqual([]);expect(toasts(app)).toEqual([]);
  app.interactor.close();
  app.view.open('CONTROLS');expect(frame(app)).toMatchObject({busy:true});
  app.view.close();expect(frame(app)).toMatchObject({busy:false});

  frame(app,{kind:'line',npcId:'person',line:'[laugh] Keep up.'});
  expect(toasts(app)).toEqual(['Petra MossKeep up.']);
  expect(observer.said).toHaveBeenLastCalledWith({conversation:{npcId:'person',instance:person},line:null,text:'[laugh] Keep up.'});

  // A leader with no body to talk to says its arrival line on the street.
  person.gone=true;
  frame(app,ARRIVAL);
  expect(app.interactor.talkTo).toHaveBeenCalledExactlyOnceWith('person',app.clock);expect(app.arriving).toBeNull();
  expect(app.view.dialog.element.hidden).toBe(true);
  expect(toasts(app).at(-1)).toBe('Petra MossHere it is: Market.');expect(log.at(-1)).toBe('said: Here it is: Market.');

  frame(app,{kind:'ended',npcId:'person',reason:'gave-up',notice:'Petra Moss lost you and went back.'},{kind:'ended',npcId:'person',reason:'done'});
  expect(toasts(app).at(-1)).toBe('CompanionPetra Moss lost you and went back.');
 });

 it('drops a failed half reply, silencing what was heard of it, and offers Retry, but says a refused line cannot be retried',async()=>{
  const {app,open,log}=fixture();open();const user=userEvent.setup();const chat=within(app.view.dialog.element);
  app.talk.stream.mockImplementationOnce(()=>talkStream([{type:'delta',text:'Half a thought. '},{type:'sentence',index:0,text:'Half a thought.'}],talkError('model server 500 at x',502)));
  log.length=0;
  await user.type(chat.getByRole('textbox'),'hello{Enter}');
  await vi.waitFor(()=>expect(chat.getByRole('button',{name:'Retry reply'})).toBeTruthy());
  expect(said(app).queryByText(/Half a thought/)).toBeNull();expect(chat.getByText(/reply could not be reached/)).toBeTruthy();
  expect(log).toEqual(['silenced','said: Half a thought.','silenced']);expect(app.animations.completeDialogueTurn).toHaveBeenCalledOnce();
  app.talk.stream.mockImplementationOnce(()=>talkStream([],talkError('talk request does not match its contract: /npc must NOT have additional properties',400)));
  await user.click(chat.getByRole('button',{name:'Retry reply'}));
  await vi.waitFor(()=>expect(chat.getByText(/refused this line/)).toBeTruthy());
  expect(chat.queryByRole('button',{name:'Retry reply'})).toBeNull();expect(chat.getByRole('textbox').disabled).toBe(false);
  expect(said(app).getAllByText('hello')).toHaveLength(1);expect(app.talk.stream).toHaveBeenCalledTimes(2);expect(log).toHaveLength(3);
 });

 it('lets a passer-by without identity brush the player off, and says plainly that free chat is unavailable',async()=>{
  const {app,observer}=fixture();
  app.interactor.conversation={npcId:null,instance:null,behavior:null};app.presentConversation(app.interactor.conversation);
  expect(screen.getByRole('dialog',{name:'Someone passing by'})).toBeTruthy();
  const chat=within(app.view.dialog.element);
  expect(chat.queryByRole('textbox')).toBeNull();expect(chat.getByText('This passer-by has no time to chat.')).toBeTruthy();
  expect(said(app).getByText('Sorry, I can\'t stop.').closest('.chat-line').firstElementChild.textContent).toBe('Someone passing by');
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
