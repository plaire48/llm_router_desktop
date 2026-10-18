import React from 'react';
import {Icon} from '@e2e/cx-design-system';
export function IrreversibleNotice({value,alwaysAllowIgnored=false}){
 if(!value)return null;
 return <p className="nubi-decision-scope" data-irreversible-notice><Icon name="alertCircle" size={16}/><span>{alwaysAllowIgnored?'외부 반영 도구라 항상 허용을 적용하지 않아요':`되돌리기 어려운 작업(${value.reason})이라 자동 모드에서도 확인해요.`}</span></p>;
}
