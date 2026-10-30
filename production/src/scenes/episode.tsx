import {makeScene2D, Rect, Txt} from '@motion-canvas/2d';
import {EpisodeVideo as Video} from '../episode-video';
import {createRef, waitFor, useThread} from '@motion-canvas/core';
import {heldSourceTime, sourceTime, type EpisodePlan} from '../timeline';
export type {EpisodePlan} from '../timeline';
const width=1920,height=1080;

export function createEpisodeScene(plan:EpisodePlan,episode:string){
 const cameras=new Map(plan.cameras.map(c=>[c.id,c]));
 return makeScene2D(function* (view){
  view.fill('#101d26');
  let previous:Rect|undefined;
  for(const segment of plan.segments){
   const group=createRef<Rect>();
   const clock=useThread().time;const segmentStart=clock();
   view.add(<Rect ref={group} width={width} height={height} fill="#101d26" opacity={previous?0:1}/>);
   if(segment.kind==='shot'&&segment.shot){
    const shot=segment.shot;
    shot.cameras.forEach((id,i)=>{
     const camera=cameras.get(id);if(!camera)throw Error('Unknown camera '+id);
     const pip=shot.kind==='pip'&&i===1,split=shot.kind==='split';
     const video=createRef<Video>();
     group().add(<Video ref={video} src={`/${episode}/video/${camera.file}`}
      width={pip?620:split?952:width} height={pip?348.75:split?535.5:height}
      x={split?(i===0?-480:480):pip?600:0} y={pip?-310:0}
      time={()=>heldSourceTime(camera,shot,clock()-segmentStart)} smoothing={false} stroke="#e4eadb" lineWidth={pip?4:0}/>);

    });
    if(shot.kind==='split'){
     shot.cameras.forEach((id,i)=>group().add(<Txt text={id.replace('-',' ').toUpperCase()} x={i===0?-480:480} y={-350} fontSize={26} fill="#b7d6d9"/>));
    }
    if(shot.label)group().add(<Rect y={460} width={1760} height={86} fill="#101d26e8" radius={8}>
     <Txt text={shot.label} width={1670} fontSize={32} fill="#f0f2e6" fontFamily="Arial" textAlign="center" textWrap/>
    </Rect>);
   }else{
    if(segment.background){
     const camera=cameras.get(segment.background.camera);
     if(!camera)throw Error('Unknown title background camera '+segment.background.camera);
     group().add(<Video src={`/${episode}/video/${camera.file}`} width={width} height={height}
      time={sourceTime(camera,segment.background.time)} smoothing={false}/>);
     group().add(<Rect width={width} height={height} fill="#07121bd9"/>);
    }
    group().add(<Rect width={90} height={5} y={-245} fill="#9ccec9"/>);
    group().add(<Txt text="THE AGENT TERRARIUM" y={-175} fontSize={64} fontFamily="Arial" fontWeight={700} fill="#f0f2e6"/>);
    group().add(<Txt text={segment.text??''} y={55} width={1360} height={280} textWrap fontSize={40}
     fontFamily="Arial" fill="#b7d6d9" textAlign="center"/>);
    if(segment.kind==='outro')group().add(<Txt text="OBSERVE · QUESTION · TRY AGAIN"
     y={330} fontSize={25} fontFamily="Arial" fill="#829da7"/>);
   }
   const fade=previous?(segment.transition??.2):0;
   if(fade)yield* group().opacity(1,fade);
   if(previous){previous.remove();previous.dispose();}
   yield* waitFor(segment.duration-fade);
   previous=group();
  }
 });
}
