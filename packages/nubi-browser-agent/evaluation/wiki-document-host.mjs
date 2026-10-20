import {mkdir} from 'node:fs/promises';
import {createFileWikiDocuments} from '../dist/knowledge-files.js';

// Evaluation-only durable repository. Production hosts inject their existing authorized wiki repository.
export function fileWikiDocuments(root){
 const delegate=createFileWikiDocuments({root,authorize:async()=>true});
 return {
  async read(...args){await mkdir(root,{recursive:true});return delegate.read(...args);},
  async compareAndSet(...args){await mkdir(root,{recursive:true});return delegate.compareAndSet(...args);},
 };
}
