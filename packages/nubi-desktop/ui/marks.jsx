import React from 'react';
import {Icon} from './LucideIcon.jsx';

// Existing mark API, one Lucide family and the same common icon tokens.
export const SparklesMark=({size=22})=><Icon name="sparkles" size={size}/>;
export const FolderMark=({size=22})=><Icon name="folder" size={size}/>;
export const FolderOpenMark=({size=22})=><Icon name="folderOpen" size={size}/>;
export const BranchMark=({size=22})=><Icon name="gitBranch" size={size}/>;
export const TerminalMark=({size=22})=><Icon name="terminal" size={size}/>;
export const WindowMark=({size=22})=><Icon name="window" size={size}/>;
export const BrowserMark=({size=22})=><Icon name="browser" size={size}/>;
export const StopMark=({size=22})=><Icon name="stop" size={size}/>;
export const PointerMark=({size=22})=><Icon name="pointer" size={size}/>;
export const KeyboardMark=({size=22})=><Icon name="keyboard" size={size}/>;
export const LockMark=({size=22})=><Icon name="lock" size={size}/>;
export const HomeMark=({size=22})=><Icon name="home" size={size}/>;
export const PersonMark=({size=22})=><Icon name="user" size={size}/>;
export const CompanyMark=({size=22})=><Icon name="company" size={size}/>;
export const SignpostMark=({size=22})=><Icon name="signpost" size={size}/>;
export const BookMark=({size=22})=><Icon name="book" size={size}/>;
export const ArchiveMark=({size=22})=><Icon name="archive" size={size}/>;
export function RecoveryStatus(){return <span className="nubi-recovery-status" role="status" aria-label="복구 대기" title="복구 대기"><SignpostMark size={14}/></span>;}
