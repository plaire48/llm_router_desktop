export const wikiRefreshErrors={
  wiki_refresh_cancelled:'코드 동기화를 중지했어요.',
  git_local_changes:'로컬 변경이 있어 원격과 동기화하지 않았어요. 변경을 보관하거나 커밋한 뒤 다시 시도해 주세요.',
  git_local_ahead:'원격에 없는 로컬 커밋이 있어요. 원격과 이력을 맞춘 뒤 다시 시도해 주세요.',
  git_diverged:'로컬과 원격 이력이 갈라졌어요. 충돌을 정리한 뒤 다시 시도해 주세요.',
  git_upstream_missing:'현재 브랜치의 원격 추적 설정을 확인해 주세요.',
  git_auth:'원격 저장소 인증을 확인한 뒤 다시 시도해 주세요.',
  git_timeout:'원격 연결 시간이 초과됐어요. 네트워크를 확인해 주세요.',
  git_pull_failed:'원격 코드를 받지 못해 위키 갱신을 멈췄어요. 저장소 연결을 확인해 주세요.',
  git_source_changed:'동기화 중 코드가 바뀌었어요. 다시 갱신해 주세요.',
  git_unavailable:'Git을 실행하지 못했어요. 앱 설치 상태를 확인해 주세요.',
  wiki_update_busy:'이미 위키를 준비하거나 갱신하고 있어요.',
};
export const wikiRefreshNotice=result=>result.initialization?(result.initialization.state==='waiting_model'?'모델을 연결하면 위키를 만들 수 있어요.':'위키 생성을 시작했어요.'):result.update?'위키 갱신을 시작했어요.':'확인한 코드와 위키가 일치해요.';
