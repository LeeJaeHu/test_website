# 신 번뜩임 조회 (웹)

Chaos Zero Nightmare **신 번뜩임** 카드 조건 조회 — 브라우저 전용, **비공식 팬 도구**입니다.

- 설치·exe·bat 없음
- 서버 전송 없음 (JSON을 브라우저에서만 읽음)
- [데스크톱 GUI](../spark_card_lookup.py)와 동일한 필터 로직

## GitHub Pages 올리기

### 1. 저장소 만들기

1. GitHub → **New repository** (Public)
2. 이름 예: `czn-god-spark-lookup`

### 2. 이 `web/` 폴더 내용을 push

**방법 A — web 폴더만 저장소 루트로**

```bash
cd web
git init
git add .
git commit -m "Add spark lookup web app"
git branch -M main
git remote add origin https://github.com/YOUR_ID/czn-god-spark-lookup.git
git push -u origin main
```

**방법 B — monorepo에서 `/web` 하위**

Settings → Pages → Branch `main` → Folder **`/web`**

(GitHub Pages는 저장소 루트 또는 `/docs`만 지원하므로, monorepo면 **web 내용을 루트로 옮기거나** 별도 repo 권장)

### 3. Pages 활성화

Settings → **Pages** → Source: **Deploy from branch** → `main` / **root** → Save

몇 분 후: `https://YOUR_ID.github.io/czn-god-spark-lookup/`

### 4. 데이터 갱신 (패치 후)

저장소 **루트**(또는 상위 프로젝트)에서:

```bash
pip install openpyxl
python export_web_data.py
```

생성된 `web/data/*.json`과 (선택) `web/assets/portraits/`를 commit & push.

**용량 참고:** `export_web_data.py`는 GitHub용으로 초상화를 128px webp 썸네일(~2KB/장)로 만듭니다.  
`web/` 전체는 약 **2MB** 수준이면 Pages에 무리 없습니다. 게임 `bin/`·`data.pack` 등은 **push하지 마세요**.

## 로컬 미리보기

`file://`로 열면 JSON fetch가 막힐 수 있습니다.

```bash
cd web
python -m http.server 8080
```

→ http://localhost:8080

## 파일 구성

| 파일 | 설명 |
|------|------|
| `index.html` | 신 번뜩임 조회 UI |
| `common.html` | 일반 번뜩임 목록 UI |
| `app.js` | 신 번뜩임 필터·묶기 로직 |
| `common.js` | 일반 번뜩임 필터·목록 |
| `style.css` | 스타일 |
| `data/lookup.json` | 신 번뜩임 데이터 (`export_web_data.py` 생성) |
| `data/cards.json` | 카드·캐릭터·번뜩임 선택 데이터 (`export_web_data.py` 생성) |
| `assets/portraits/` | 캐릭터 썸네일 (선택, export 시 생성) |
| `.nojekyll` | GitHub Pages Jekyll 비활성 |

## 면책

게임 클라이언트 데이터를 파싱한 비공식 도구입니다. Smilegate와 무관하며, 이용약관·저작권을 준수해 주세요.
