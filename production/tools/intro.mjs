/** Opening copy is a short, verbatim objective excerpt, not the operational brief. */
export function summarizeGoal(goal){
 const paragraphs=String(goal??'').trim().split(/\n\s*\n/),selected=[];
 for(const paragraph of paragraphs){
  const text=paragraph.replace(/\s+/g,' ').trim();
  if(!text||/^#/.test(text))continue;
  if(/^(?:you start\b|start\s*:|known geography\b|goal\s*:|you have a maximum\b|use only\b|when you\b|call finish_session\b|these facts\b|[-*]\s)/i.test(text))break;
  selected.push(text);
  if(selected.length===2)break;
 }
 const text=selected.join(' ')||String(goal??'').replace(/\s+/g,' ').trim();
 const sentences=text.match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/g)??[text];
 let summary='';
 for(const sentence of sentences.slice(0,4)){
  const next=(summary+' '+sentence.trim()).trim();
  if(next.length>280)break;
  summary=next;
 }
 if(summary)return summary;
 return text.length<=280?text:text.slice(0,277).replace(/\s+\S*$/,'')+'…';
}
