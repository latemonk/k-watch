import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyAircraftKind, isRotorcraft } from '../src/config/aircraft-kind.ts';

// 실제 ADS-B 피드(adsb.lol)에서 관측되는 형식판정부호. 한반도 상공 실기체
// (육군 H60·H64·H47·H500, 해경 A139·KA32·B412, 닥터헬기 EC35·A169,
// 주한미군 V22)를 포함한다.
const ROTORCRAFT = [
  'H60', 'H64', 'H47', 'H500', 'H145', 'H135', 'H160',
  'EC30', 'EC35', 'EC45', 'EC55', 'AS32', 'AS50', 'AS65',
  'B06', 'B412', 'B429', 'B505', 'S76', 'S92', 'S64',
  'KA27', 'KA32', 'MI8', 'MI17', 'MI24',
  'A109', 'A139', 'A169', 'A189', 'EH10', 'NH90',
  'R22', 'R44', 'R66', 'EXPL', 'MD52', 'BK17', 'W3',
  'PUMA', 'GAZL', 'LYNX', 'TIGR', 'KUH1', 'V22',
  'UH60', 'AH64', 'CH47', 'MH60', 'SH60', 'OH58', 'TH57',
];

// 회전익 접두를 닮았거나 인접한 고정익 — 오탐이 나면 지도 아이콘이 틀린다.
const FIXED_WING = [
  'B738', 'B38M', 'B763', 'B77W', 'B744', 'B748', 'A320', 'A321', 'A20N', 'A21N',
  'A332', 'A333', 'A359', 'A35K', 'B788', 'B78X', 'GLEX', 'C172', 'CRJ9', 'E75L',
  'H25A', 'H25B', 'H25C',   // Hawker 700/800/1000 — 'H+숫자' 접두 함정
  'SH33', 'SH36',           // Shorts 330/360 — 군용 임무기호 접두 함정
  'A124', 'A140', 'A148', 'A158', // 안토노프 — Leonardo A1xx 헬기와 인접
  'B461', 'B462', 'B463',   // BAe 146 — Bell B4xx 헬기와 인접
  'C130', 'E3TF', 'P8', 'F16', 'KC30',
];

describe('회전익(헬기) 판정 — aircraft-kind', () => {
  it('헬기 형식판정부호를 모두 회전익으로 판정한다', () => {
    for (const type of ROTORCRAFT) {
      assert.equal(classifyAircraftKind({ aircraftType: type }), 'helicopter', `${type} 를 헬기로 못 잡았어요`);
    }
  });

  it('고정익(특히 접두 함정 기종)을 회전익으로 오탐하지 않는다', () => {
    for (const type of FIXED_WING) {
      assert.equal(classifyAircraftKind({ aircraftType: type }), 'fixedWing', `${type} 를 헬기로 오탐했어요`);
    }
  });

  it('기종을 몰라도 ADS-B 에미터 카테고리 A7 이면 회전익', () => {
    assert.equal(classifyAircraftKind({ emitterCategory: 'A7' }), 'helicopter');
    assert.equal(classifyAircraftKind({ aircraftType: '', emitterCategory: 'a7' }), 'helicopter');
  });

  it('에미터 카테고리가 A7 이어도 명시적 고정익 예외는 고정익으로 남는다', () => {
    assert.equal(classifyAircraftKind({ aircraftType: 'H25B', emitterCategory: 'A7' }), 'fixedWing');
  });

  it('기종·카테고리를 둘 다 모르면 고정익(기존 아이콘 유지)', () => {
    assert.equal(classifyAircraftKind({}), 'fixedWing');
    assert.equal(isRotorcraft({ aircraftType: '', emitterCategory: '' }), false);
  });

  it('대소문자·여백에 흔들리지 않는다', () => {
    assert.equal(isRotorcraft({ aircraftType: ' h60 ' }), true);
    assert.equal(isRotorcraft({ aircraftType: 'ec45' }), true);
  });
});
