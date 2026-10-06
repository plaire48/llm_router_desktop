// 상품 목록 점검. 배포 전에 npm run check로 실행한다.
// 항목마다 가격, 배송 지역, 등급을 확인하고 결과를 한 줄씩 남긴다.
import {readFile} from 'node:fs/promises';
import {RATES} from '../src/discount.mjs';

const REGIONS = ['seoul', 'busan', 'daegu', 'jeju', 'island'];
const items = JSON.parse(await readFile(new URL('../catalog/items.json', import.meta.url), 'utf8'));
let errors = 0;
items.forEach((item, index) => {
  // 목록 파일은 한 줄에 항목 하나다. 첫 줄은 여는 괄호다.
  const where = `catalog/items.json:${index + 2}`;
  const report = (ok, done, problem) => {
    if (ok) console.log(`[검사] ${item.sku} ${done}`);
    else { errors++; console.log(`[오류] ${where} ${item.sku} ${problem}`); }
  };
  report(Number.isInteger(item.price) && item.price > 0, `가격 ${item.price}원 확인`, `가격이 원 단위 양의 정수가 아님: ${item.price}`);
  report(REGIONS.includes(item.region), `지역 ${item.region} 확인`, `허용되지 않은 지역: ${item.region} (허용: ${REGIONS.join(', ')})`);
  report(Object.hasOwn(RATES, item.grade), `등급 ${item.grade} 확인`, `할인 정책에 없는 등급: ${item.grade}`);
});
console.log(`검사 ${items.length}건, 오류 ${errors}건.`);
process.exitCode = errors ? 1 : 0;
