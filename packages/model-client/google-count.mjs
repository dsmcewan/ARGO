// CountTokens' extraBody bypasses @google/genai's generation converters. Match the
// pinned 2.32.0 tContent/tSchema/tTool and response-schema alias behavior here.
// The recording-fetch tests compare these bytes with that SDK's independent serializer.
const schemaTypes=new Set(['TYPE_UNSPECIFIED','STRING','NUMBER','INTEGER','BOOLEAN','ARRAY','OBJECT','NULL']);
const schemaType=value=>{
  if(typeof value!=='string')throw new Error('Google schema type must be a string');
  const upper=value.toUpperCase();
  return schemaTypes.has(upper)?upper:'TYPE_UNSPECIFIED';
};

function schema(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Google schema must be an object');
  if(value.type&&value.anyOf)throw new Error('Google schema type and anyOf cannot both be populated');
  let source=value;
  const result={};
  if(value.anyOf?.length===2){
    const nullIndex=value.anyOf.findIndex(item=>item.type==='null');
    if(nullIndex!==-1){result.nullable=true;source=value.anyOf[1-nullIndex];}
  }
  if(Array.isArray(source.type)){
    const types=source.type.filter(type=>type!=='null');
    if(types.length!==source.type.length)result.nullable=true;
    if(types.length===1)result.type=schemaType(types[0]);
    else result.anyOf=types.map(type=>({type:schemaType(type)}));
  }
  for(const [key,item] of Object.entries(source)){
    if(item==null||key==='additionalProperties')continue;
    if(key==='type'){
      if(item==='null')throw new Error('Google schema type null cannot be the only type');
      if(!Array.isArray(item))result.type=schemaType(item);
    }else if(key==='items')result.items=schema(item);
    else if(key==='properties')result.properties=Object.fromEntries(Object.entries(item).map(([name,property])=>[name,schema(property)]));
    else if(key==='anyOf'){
      if(!Array.isArray(item))throw new Error('Google schema anyOf must be an array');
      result.anyOf=[];
      for(const branch of item){
        if(branch.type==='null')result.nullable=true;
        else result.anyOf.push(schema(branch));
      }
    }else result[key]=item;
  }
  return result;
}

function content(value){
  if(Array.isArray(value?.parts))return {parts:value.parts,...(value.role!=null?{role:value.role}:{})};
  const parts=Array.isArray(value)?value:[value];
  if(!parts.length)throw new Error('Google system instruction parts are required');
  return {role:'user',parts:parts.map(part=>{
    if(typeof part==='string')return {text:part};
    if(part&&typeof part==='object'&&!Array.isArray(part))return part;
    throw new Error('Google system instruction must contain strings or Parts');
  })};
}

export function googleCountConfig(config){
  // Do not alter generation inputs or attempt to clone the live AbortSignal.
  const transport=new Set(['abortSignal','httpOptions','automaticContinuation']);
  const normalized=structuredClone(Object.fromEntries(Object.entries(config).filter(([key,value])=>!transport.has(key)&&value!=null)));
  if(normalized.systemInstruction!==undefined)normalized.systemInstruction=content(normalized.systemInstruction);
  if(normalized.responseSchema!==undefined){
    if(Object.hasOwn(normalized.responseSchema,'$schema')&&!normalized.responseJsonSchema){
      // In 2.32.0 unary generation snapshots tools/config before moving this alias,
      // while streaming moves it first. Require the unambiguous explicit wire field.
      if(normalized.tools)throw new Error('Use responseJsonSchema explicitly when combining a JSON Schema response with Google tools');
      normalized.responseJsonSchema=normalized.responseSchema;
      delete normalized.responseSchema;
    }else normalized.responseSchema=schema(normalized.responseSchema);
  }
  for(const tool of normalized.tools??[])for(const declaration of tool.functionDeclarations??[]){
    for(const key of ['parameters','response']){
      const value=declaration[key];
      if(value==null)continue;
      const jsonKey=`${key}JsonSchema`;
      if(Object.hasOwn(value,'$schema')){
        if(!declaration[jsonKey]){declaration[jsonKey]=value;delete declaration[key];}
      }else declaration[key]=schema(value);
    }
  }
  return normalized;
}
