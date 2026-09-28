import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {applyHumanReviews} from './review.mjs';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [reportPath,reviewsPath,outputPath]=process.argv.slice(2);
  if(!reportPath||!reviewsPath||!outputPath||[reportPath,reviewsPath].includes(outputPath))throw new Error('review_distinct_output_required');
  const report=JSON.parse(await readFile(reportPath,'utf8')),reviews=JSON.parse(await readFile(reviewsPath,'utf8'));
  const result=applyHumanReviews(report,reviews);await writeFile(outputPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result.accuracy));
}
