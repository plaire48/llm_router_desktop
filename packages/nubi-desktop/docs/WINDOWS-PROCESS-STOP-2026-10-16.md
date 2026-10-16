# Windows 명령 중지 확인

배포 검사 38854363664에서 Git Bash 실행 직후 중지가 10초 안에 완료되지 않았다. Mac 회귀는 통과했지만 Windows 설치판 공개를 보류했다. 기존 taskkill 호출은 결과를 버리고 한 번만 요청했다.

Windows 시스템 경로의 taskkill.exe를 셸 없이 호출하고, 같은 ChildProcess가 살아 있는 동안 최대 3회 종료를 확인한다. 프로세스가 끝났거나 다른 프로세스로 교체되면 재호출하지 않는다. 프로세스 이름 전체 종료는 사용하지 않는다. 중지 요청이 중복돼도 원래 사용자 취소/시간 초과 사유를 덮어쓰지 않는다. 실제 close 전에는 cancelled나 timed_out으로 확정하지 않는다. 확인되지 않으면 고정 진단 코드와 시도 수만 보관한다.

기존 시험의 취소 대기만 15초로 조정했다. 원래 명령은 30초 후 자연 종료하므로 기다리기만 해서 통과할 수 없다. Windows 빌드 전에 같은 사례를 5회 반복하고 기존 전체 복구 검사에서도 다시 확인한다.

설계 근거: [Microsoft taskkill 문서](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill)의 PID, /T, /F 계약을 따른다. [Git for Windows wrapper 문서](https://gitforwindows.org/git-wrapper.html)는 bin/bash.exe가 실제 Bash를 시작하는 별도 실행 파일임을 설명한다. 이번 실패를 wrapper 단독 원인으로 확정하거나 셸 환경을 임의로 재구현하지 않는다. 새 종속성 대신 기존 네이티브 종료 수단의 결과 확인을 보완했다.
