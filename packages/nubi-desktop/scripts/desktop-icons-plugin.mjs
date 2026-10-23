import path from 'node:path';

// Use the pinned CX source entry so its internal ActionButton/SearchInput icons
// share the Desktop adapter. Never edit the installed package or other hosts.
export function desktopIconsPlugin(){
 const cx=path.resolve('node_modules/@e2e/cx-design-system'),icon=path.resolve('ui/LucideIcon.jsx');
 return {name:'nubi-desktop-icons',setup(builder){
  builder.onLoad({filter:/[\\/]@e2e[\\/]cx-design-system[\\/]dist[\\/]index\.js$/},({path:file})=>{
   if(file!==path.join(cx,'dist/index.js'))return;
   return {contents:`export * from ${JSON.stringify(path.join(cx,'src/index.jsx'))};`,loader:'js',resolveDir:cx};
  });
  builder.onLoad({filter:/[\\/]@e2e[\\/]cx-design-system[\\/]src[\\/]Icon\.jsx$/},({path:file})=>{
   if(file!==path.join(cx,'src/Icon.jsx'))return;
   return {contents:`export {Icon,ICON_NAMES,SearchInput} from ${JSON.stringify(icon)};`,loader:'js',resolveDir:cx};
  });
 }};
}
