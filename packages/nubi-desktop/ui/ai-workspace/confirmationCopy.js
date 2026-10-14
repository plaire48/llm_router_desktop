export const CONFIRMATION_COPY = Object.freeze({
  leave: {title:'저장하지 않고 이동할까요?',message:'저장하지 않은 변경 사항이 사라집니다.',confirmLabel:'저장하지 않고 이동'},
  close: {title:'저장하지 않고 닫을까요?',message:'저장하지 않은 변경 사항이 사라집니다.',confirmLabel:'저장하지 않고 닫기'},
  reset: {title:'마지막 저장값으로 되돌릴까요?',message:'저장하지 않은 변경 사항이 사라집니다.',confirmLabel:'초기화'},
  discard: {title:'수정을 취소할까요?',message:'현재 항목에서 수정한 내용이 사라집니다.',confirmLabel:'수정 취소'},
  reload: {title:'최신 기준을 불러올까요?',message:'저장하지 않은 변경 사항이 사라집니다.\n마지막 저장값을 불러옵니다.',confirmLabel:'최신 기준 불러오기'},
  refresh: {title:'새로고침할까요?',message:'저장하지 않은 변경 사항이 사라집니다.\nE2E Agent 현황으로 이동합니다.',confirmLabel:'저장하지 않고 새로고침'},
  logout: {title:'저장하지 않고 로그아웃할까요?',message:'저장하지 않은 변경 사항이 사라집니다.',confirmLabel:'로그아웃'},
  read: {title:'변경 사항을 저장할까요?',message:'저장 후 보기는 변경 내용을 저장합니다.\n반영 안 함은 저장 전 수정을 버립니다.',confirmLabel:'저장 후 보기'},
  workflow: {title:'저장하지 않고 워크플로우를 열까요?',message:'저장하지 않은 자동화율 수정이 사라집니다.',confirmLabel:'저장하지 않고 열기'},
  upload: {title:'새 YAML을 적용할까요?',message:'워크플로우와 Action 설정이 새 파일로 바뀝니다.\n저장을 눌러야 반영됩니다.',confirmLabel:'업로드',cancelLabel:'취소'},
});
export const confirmationCopy = (kind, overrides = {}) => ({cancelLabel:'계속 수정',...CONFIRMATION_COPY[kind],...overrides});
