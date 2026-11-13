import {Circle, Rect, Txt} from '@motion-canvas/2d';
import {EpisodeVideo as Video} from './episode-video';
import type {TitleCard, TitleCardFact, TitleCardMode} from './timeline';

export const titleCardAccents = {
 competitive: '#E8C36A', arena: '#F08A4B', tycoon: '#5FD3C4', sandbox: '#8BD46A', simulation: '#A99BF5',
} satisfies Record<TitleCardMode, string>;

const bg = '#090C12', panel = '#0E131B', border = '#1E2633', muted = '#8B95A5', white = '#E9EDF2';
const sans = 'Space Grotesk, Arial', mono = 'JetBrains Mono, Menlo, monospace';
const box = (x: number, y: number, width: number, height: number, fill: string, radius = 0, stroke?: string) =>
 <Rect x={x-960+width/2} y={y-540+height/2} width={width} height={height} fill={fill}
  radius={radius} stroke={stroke} lineWidth={stroke ? 1 : 0}/>;
const copy = (text: string, x: number, y: number, width: number, size: number, color = white,
 weight = 400, family = sans) =>
 <Txt text={text} x={x-960} y={y-540} offset={[-1,-1]} width={width} fontSize={size} fontFamily={family}
  fontWeight={weight} fill={color} textAlign="left" textWrap lineHeight={size*1.13}/>;
const label = (text: string, x: number, y: number, width: number, color = muted) =>
 copy(text.toUpperCase(),x,y,width,15,color,600,mono);
const fact = (f: TitleCardFact,x: number,y: number,w: number,h: number, accent: string) =>
 <>{box(x,y,w,h,panel,12,border)}{label(f.label,x+22,y+15,w-44,accent)}
  {copy(f.unit ? f.value+' '+f.unit : f.value,x+22,y+42,w-44,30,white,700)}</>;

export function titleCardView(card: TitleCard, background?: {src: string; time: number}) {
 const accent = titleCardAccents[card.mode];
 const setup = card.layout==='opening' ? card.setup : undefined;
 return <>
  {box(0,0,1920,1080,bg)}
  <Circle x={-831} y={-447} width={22} height={26} stroke={accent} lineWidth={2}/>
  {box(115,100,28,2,accent)}
  {label('THE AGENT TERRARIUM',163,82,520,white)}
  <Txt text={card.mode.toUpperCase()} x={846} y={-448} offsetX={1} fontFamily={mono} fontSize={18} fill={accent}/>
  {label(card.kicker,112,218,870,accent)}
  {copy(card.title,112,258,865,card.layout==='opening'?104:94,white,700)}
  {card.layout==='opening' ? <>
   {copy(card.premise,112,398,850,29,'#C4CAD5')}
   {Array.isArray(setup) ? setup.map((f,i)=>fact(f,112+(i%2)*439,555+Math.floor(i/2)*126,420,112,accent))
    : setup && <>{box(112,555,850,242,panel,12,border)}{label(setup.label,140,579,794,accent)}
     {copy(setup.text,140,622,794,28)}</>}
   {box(1068,179,740,680,panel,38,border)}
   {background && <Rect x={478} y={-21} width={736} height={676} radius={36} clip>
    <Video src={background.src} time={background.time} width={736} height={414} smoothing={false} opacity={.30}/>
   </Rect>}
   {label('OBSERVATION WINDOW',1100,205,360)}
   {card.observation && label(card.observation,1540,205,240,accent)}
  </> : <>
   {card.stats.map((f,i)=>fact(f,112+i*278,507,260,109,accent))}
   {box(112,658,816,1,border)}
   {copy(card.question,112,703,816,41,white,700)}
   {copy(card.premise,112,780,816,27,'#C4CAD5')}
   {box(1048,194,760,428,panel,18)}
   {box(1048,652,400,225,panel,18)}
   <Circle x={678} y={223} width={198} height={198} fill={panel}/>
  </>}
  {box(112,962,1696,1,border)}
  {card.facts.map((f,i)=><>{label(f.label,112+i*425,984,400)}
   {copy(f.value,112+i*425,1011,402,20)}</>)}
 </>;
}
