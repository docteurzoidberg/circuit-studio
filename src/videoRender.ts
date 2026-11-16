import {create} from 'zustand';
import type {Progress} from './videoExport';

/**
 * The video being rendered, whoever started it (the Auto Video dialog or the automation API), so the page always
 * shows its progress and lets the visitor cancel it.
 */
export const useVideoRender=create<{progress:Progress|null;message:string}>(()=>({progress:null,message:''}));
export const videoAbort:{current:AbortController|null}={current:null};
