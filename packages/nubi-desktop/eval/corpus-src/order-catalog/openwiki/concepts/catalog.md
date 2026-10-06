---
type: concept
title: 상품 목록
description: 상품 목록 파일의 항목, 배송 지역 코드, 배포 전 점검.
tags: [상품, 목록, 점검, 지역]
---

# 상품 목록

상품 목록은 `catalog/items.json`에 있다. 한 줄에 상품 하나를 적는다.

| 항목 | 뜻 |
|---|---|
| `sku` | 상품 코드. `SKU-` 뒤에 네 자리 숫자 |
| `price` | 판매가. 원 단위 양의 정수 |
| `region` | 출고 지역 코드 |
| `grade` | 적용할 회원 등급. [할인 정책](discount-policy.md)의 등급 코드 |

## 지역 코드

| 코드 | 지역 |
|---|---|
| `seoul` | 서울 |
| `busan` | 부산 |
| `daegu` | 대구 |
| `jeju` | 제주 |
| `island` | 도서 지역 |

제주와 도서 지역의 추가 배송비는 [배송 정책](shipping-policy.md)을 따른다.

## 배포 전 점검

`npm run check`(`scripts/check-catalog.mjs`)가 상품마다 가격, 지역, 등급을 확인한다. 문제가 있으면 `[오류]`로 시작하는 줄에 파일 위치와 상품 코드를 적고 실패로 끝난다. 점검 규칙을 바꾸지 말고 목록의 값을 고친다.
