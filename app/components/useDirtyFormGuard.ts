'use client';
import {useEffect,useRef,useState} from 'react';
export type SaveStatus='saved'|'unsaved'|'saving'|'error';
/** Drafts and locks are mount-local, including credentials. Never persisted in browser storage. */
export function useDirtyFormGuard(onDirtyChange?: (dirty:boolean)=>void){
 const dirty=useRef(false),lock=useRef(false);
 const [status,setStatus]=useState<SaveStatus>('saved');
 useEffect(()=>{if(!dirty.current)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[status]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 const mark=()=>{dirty.current=true;setStatus('unsaved');onDirtyChange?.(true);};
 const saved=()=>{dirty.current=false;setStatus('saved');onDirtyChange?.(false);};
 return {dirty,lock,status,setStatus,mark,saved};
}
