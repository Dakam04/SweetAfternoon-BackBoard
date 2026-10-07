// 운영 중 바꿀 수 있는 값은 모두 여기에 모은다.
window.BACK_CONFIG = {
  // localStorage 키. 바꾸면 기존에 저장한 기록이 보이지 않게 되므로 주의.
  storageKey: 'sweet-afternoon-back:v1',

  // 날짜가 바뀌는 시각. 이 시각 전(예: 새벽 3시)에 열면 「今日」를 전날 영업일로 본다.
  dayChangeHour: 6,

  // 「ドリンク杯数」에 더하는 품목 id
  drinkItems: ['drink', 'shot'],

  // 처음 품목 (「設定」 탭에서 추가·수정·삭제 가능. 여기는 처음 한 번만 쓰인다)
  //   id: 기록과 연결되는 고유 이름. 한 번 정하면 바꾸지 않는다.
  //   back: 1개당 백 금액(円). 0 이면 입력할 때 금액을 직접 넣는다 (ガチャ 등)
  items: [
    { id: 'drink', name: 'ドリンク', back: 360 },
    { id: 'shot', name: 'ショット', back: 450 },
    { id: 'teaSet', name: 'お茶会セット', back: 300 },
    { id: 'cheki', name: 'チェキ', back: 200 },
    { id: 'castPlus', name: 'キャスト追加', back: 200 },
    { id: 'karaoke', name: '歌リク', back: 200 },
    { id: 'duet', name: 'デュエット', back: 300 },
    { id: 'gacha', name: 'ガチャ', back: 0 },
    { id: 'champagneSoft', name: 'シャンメリー', back: 800 },
    { id: 'mikanPon', name: 'みかんポン', back: 1400 },
    { id: 'philipco', name: 'フィリコ', back: 20000 },
    { id: 'originalLight', name: 'オリジナルライト', back: 1000 },
    { id: 'oriChan', name: 'オリシャン', back: 6000 },
    { id: 'oriChanRose', name: 'オリシャンロゼ', back: 10000 },
    { id: 'moetNectar', name: 'モエネク', back: 8800 },
    { id: 'soumei', name: 'ソウメイ', back: 16000 },
    { id: 'belleEpoque', name: 'ベルエポック', back: 10000 },
    { id: 'angelBlack', name: 'エンジェルブラック', back: 32000 },
    { id: 'angelWhite', name: 'エンジェルホワイト', back: 40000 },
    { id: 'rabbitFlower', name: 'ラビットフラワー', back: 40000 },
  ],
};
