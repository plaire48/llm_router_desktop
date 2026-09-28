import test from 'node:test';
import assert from 'node:assert/strict';
import {isInformationRequest} from '../request-intent.js';

test('lookups with citation wording or forbidden writes are information requests', () => {
  for (const goal of ['펜싱 선수 오상욱의 종목과 소속을 찾아 알려줘. 동명이인이나 오래된 소속이면 구분하고 출처를 붙여 줘.',
    '검색창에 국립중앙박물관 관람시간을 검색하고 검색 결과 첫 화면의 일반 결과 2개 제목과 링크를 알려줘. 광고는 제외해 줘.',
    '현재 페이지의 제목을 확인하고 못 찾으면 확인한 범위를 밝혀 줘. 저장하지 마.',
    '국립중앙박물관에서 올린 영상 한 편을 열어 제목, 채널, 길이를 알려줘. 구독하거나 좋아요를 누르지는 마.',
    '공개 자료에서 선수의 종목과 소속을 알려줘. 오래된 소속은 구분하고 확인한 출처만 붙여 줘.',
    '이 화면의 서울 날씨에서 표시 날짜와 현재 기온을 알려줘.', '검색 결과에서 펜싱 기사 한 건을 열어 제목, 언론사, 발행일, 경기 결과를 간단히 알려줘. 발행일과 수정일은 구분해 줘.',
    '이 문서의 작성자와 변경 이력을 알려줘.', '도서관 회원 가입 절차와 예약 방법을 조사해서 알려줘.', '선택한 폴더의 교육 안내를 찾아 설명해줘.',
    'Find the opening hours and cite the source. Do not submit anything.']) assert.equal(isInformationRequest(goal), true, goal);
});

test('requests that change a page, and unusable input, are not information requests', () => {
  for (const goal of ['제목에 가을 교육, 본문에 다음 두 줄을 입력해 줘. 등록은 하지 마.', '알림을 켜진 상태로 맞춰 줘. 설정을 변경해도 돼.',
    '메일을 열고 받는 사람, 제목, 본문을 작성해줘. 발송하지 마.', '이 글을 삭제해 줘.', '출처를 본문에 붙여 넣고 저장해 줘.', 'Save the draft and post it.',
    '자료 카드를 보관함으로 옮겨줘. 삭제하지 마.', '알림을 켜진 상태로 맞춰 줘. 이미 켜져 있으면 그대로 둬.', '담당 팀을 개발팀으로 선택해 줘.',
    '이 화면에서 계속 진행해.', '수정일을 오늘로 수정해 줘.', '작성자 이름을 입력하고 알려줘.', '직원 검색에서 Alice Kim을 선택하고 확인해줘. 보내지는 마.', '직원 검색에서 김민지를 키보드로 선택하고 부서를 알려줘.', '필터를 적용해서 결과를 알려줘.', '교육 과정을 신청하고 결과를 알려줘.', 'Move the card to the archive and tell me the result.', 'Turn on notifications.',
    '', '   ', '자료 '.repeat(1200), null, undefined, 3]) assert.equal(isInformationRequest(goal), false, String(goal).slice(0, 40));
});
