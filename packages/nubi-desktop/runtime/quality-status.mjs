export function qualityLabel(quality){
  if(!quality)return '문법 검사 전';
  return ({passed:'문법 검사 완료',existing_issues:`기존 문법 오류 ${quality.errorCount}개`,unsupported:'문법 검사 대상 아님',blocked:'새 문법 오류 발견',incomplete:'문법 검사 일부 완료',unavailable:'문법 검사 미완료'})[quality.state]||'문법 검사 미완료';
}

export function qualityDescription(quality){
 if(quality?.state==='unsupported')return '이 파일 형식은 내장 문법 검사 대상이 아니에요. 오류가 발견됐다는 뜻은 아니며, 실행이나 화면 검증은 별도로 필요해요.';
 if(quality?.state==='passed')return '문법 검사 완료. 타입 검사와 실행 테스트는 별도로 확인합니다.';
 return qualityLabel(quality);
}
