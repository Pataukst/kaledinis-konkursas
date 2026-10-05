# Kalėdų konkursas

Lietuviška, savarankiškai talpinama Next.js / PostgreSQL programa. Dabartinis kelias: **brūkšninis kodas ir pirkimo data → penkios dekoratyvios dėžutės, gavėjo el. paštas ir privalomas nepažymėtas naujienlaiškio sutikimas → rezultatas**. Dovana rezervuojama prieš pasirinkimą tiksliai 12 valandų; pasirinkta dėžutė dovanos nekeičia.

Tikros integracijos nesukonfigūruotos. Kūrimo imitacijos aiškiai pažymėtos, produkcijos dalyvavimas užblokuotas. Niekas viešai nediegiama. Imitacija netikrina tikrų pirkimų, nepriskiria tikrų dovanų ir nesiunčia laiškų.

## GitHub Codespaces be diegimo į darbo kompiuterį

Naudokite privatų GitHub repo, **Code → Codespaces → Create codespace**, naršyklėje. `.devcontainer/devcontainer.json` paruošia Node.js 24 ir Docker prieigą nuotolinėje aplinkoje. Jokio administratoriaus patvirtinimo jūsų darbo kompiuteryje nereikia. Node 24 / npm ir PostgreSQL lieka nuotoliniame Codespace.

Codespaces terminale, repo šaknyje:

```bash
# Tik naujai aplinkai: esamo .env neperrašykite.
test -f .env || cp .env.example .env
# .env nustatykite atsitiktinį POSTGRES_PASSWORD.
# DATABASE_URL vartotojas ir slaptažodis turi sutapti su db.
# AUDIT_HMAC_KEY nustatykite ilgu atsitiktiniu tekstu, pvz. šios komandos rezultatu:
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'

docker compose up -d db
npm ci
npm run db:migrate
npm run seed:dev
npm run admin:create

# APP_ORIGIN turi sutapti su Codespaces Ports lange rodomu 3000 HTTPS adresu.
export APP_ORIGIN="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
npm run dev -- --hostname 0.0.0.0 --webpack
```

**Ports → 3000 → Open in Browser**; portą palikite **Private**. Įrašykite tą patį APP_ORIGIN į .env, kad jis išliktų po perkrovimo. Slaptažodžių ir .env į Git nekelkite. Administravimas tame pačiame adrese `/admin`; admin:create interaktyviai prašo vardo ir 14–200 simbolių slaptažodžio, numatytojo administratoriaus nėra.

Atskirame terminale:

```bash
npm run worker
```

Worker apdoroja patvarias priskyrimo užduotis ir valo pasibaigusias rezervacijas. Nepriklausomas valymas (pvz., jei priskyrimo worker sustabdytas):

```bash
npm run worker:cleanup
```

Jis paleidžiamas iškart ir kartojamas kas minutę. Teisingas galiojimas taip pat užtikrinamas kiekvienoje susijusioje serverio operacijoje. Jokio 12 valandų laukimo testams nereikia.

## Imitacijų patikra

Pirkimo laukai: `TEST-001`…`TEST-009` arba `0001234567890` ir tikra ne ateities data. `INVALID` atmetamas, `MALFORMED`, `TIMEOUT`, `UNAVAILABLE` imituoja skirtingas paslaugos problemas. Tai tik testiniai duomenys, ne tikrų barcode formato apribojimai.

`MOCK_ASSIGNMENT=ok` – imituotas priskyrimas. Kiti režimai: `failure`, `timeout-before`, `timeout-after`, `malformed`, `swapped-guid`, `swapped-gift`. Pakeitus worker aplinką jį perkraukite. `timeout-after` pirmame bandyme išsaugo imituotą OK, bet praranda atsakymą; pakartojimas grąžina tą patį OK be antro priskyrimo. Imitacijos idempotency duomenys lieka DB po proceso restarto.

Refresh ir pakartotinis tos pačios aktyvios pirkimo rezervacijos tikrinimas išlaiko pradinį terminą. Atgal atlaisvina tik tos sesijos neužbaigtą rezervaciją. Pasibaigus terminui reikia iš naujo tikrinti pirkimą. Priimta galutinė registracija lieka apsaugota `PENDING_ASSIGNMENT`, net jei pirminis terminas praėjo. Gavėjo email apkarpomas ir paverčiamas mažosiomis raidėmis; taškai ir + nekeičiamas.

Galutinis garantuotas nepriskyrimas grąžina rezervaciją iki **pradinio** termino arba iškart ją užbaigia. Naujam bandymui atnaujinkite rezultatą: grįžtama į formą su nauju requestKey. To paties atmesto rakto kartojimas visada grąžina ankstesnį atmetimą. Neaiški baigtis neatlaisvina dovanos; be IT patvirtinto idempotency saugoma peržiūrai.

## Migracijos ir Docker

`npm run db:migrate` naudoja tik **prisma migrate deploy**. Nenaudoti reset, db push ar projekto atkūrimo. Migracija išsaugo ankstesnius Gift / Claim / Eligibility / DeliveryJob duomenis, kanalus, consent ir paskirtus kodus. Naujiems srautams pridedamos Flow, PurchaseValidation, Reservation, AssignmentClaim, AssignmentJob, AuditEvent ir MockAssignment lentelės. SQL daliniai indeksai ir apsauginiai triggeriai yra būtina schemos dalis.

Ankstesniam inventoriui priskiriami stabilūs vietiniai `LOCAL-{id}`. CSV priima:

```csv
dovanos_kodas,dovanos_pavadinimas,giftId
NETIKRAS-001,Testinė dovana,DEMO-GIFT-0001
```

Trečias stulpelis neprivalomas; be jo sugeneruojamas unikalus vietinis ID. Importas nieko neperrašo; esami kodai ir ID atmetami, taip pat jau paskirti. Archyvavimas atomiškai veikia tik laisvus vienetus. Rezervuoti, pending, assigned ir ankstesni allocated apsaugoti; admin rodo būsenas, rezervacijos terminą ir saugias priskyrimo diagnostikas.

Vietinis Docker demo:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build -d
docker compose -f compose.yaml -f compose.dev.yaml exec app npm run seed:dev
docker compose -f compose.yaml -f compose.dev.yaml exec app npm run admin:create
```

Compose migracijos baigiasi prieš app / worker; DB saugoma `database` tome. Portai rišami į localhost. Codespaces naršyklės forwarded adresui būtinas tikslus APP_ORIGIN; portai turi likti Private. `compose.dev.yaml` įjungia tik kūrimo imitacijas. Produkcijos Docker atvaizdas kompiliuojasi, bet realus dalyvavimas lieka užblokuotas. Įprastam restartui nenaudoti `docker compose down -v`.

## Konfigūracija

| Kintamasis                               | Reikšmė                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| DATABASE_URL / POSTGRES_PASSWORD         | Privatūs PostgreSQL prisijungimo duomenys; testams atskira *_test DB                                 |
| APP_ORIGIN                               | Tikslus naršyklės origin; Codespaces – 3000 privataus forwarded porto HTTPS adresas                  |
| PURCHASE_ADAPTER / DELIVERY_ADAPTER      | Kūrimo metu abu mock; real dar nesukonfigūruoti                                                      |
| MOCK_ASSIGNMENT                          | ok arba aukščiau išvardytas deterministinis scenarijus                                               |
| EXTERNAL_IDEMPOTENCY_CONFIRMED           | true tik imitacijai arba IT garantavus stabilų išorinį idempotency; false – neaiškios baigtys review |
| TRUSTED_CUSTOMER_IP_HEADER               | Tuščias Codespaces imitacijai; įmonėje tik ingress pašalinta ir patikimai perrašyta antraštė         |
| AUDIT_HMAC_KEY                           | Ilgas pastovus atskiras slaptas raktas audit maskavimui, ne Git                                      |
| AUDIT_RETENTION_DAYS                     | Audito minimali saugojimo trukmė, 365; automatinio audit trynimo nėra                                |
| CONSENT_TEXT / CONSENT_VERSION           | Patvirtintas lietuviškas sutikimas ir versija; tikrinami ir serveryje                                |
| ORGANISER_TEXT / RULES_URL / PRIVACY_URL | Organizatoriaus patvirtinti lietuviški tekstai ir nuorodos                                           |
| INTERNAL_API_TIMEOUT_MS                  | 10000, daugiausia 60000                                                                              |
| DELIVERY_MAX_ATTEMPTS / WORKER_POLL_MS   | 8 / 1000; išnaudoti bandymai – apsaugota review būsena                                               |
| CSV_MAX_BYTES / CSV_MAX_ROWS             | 1048576 / 5000                                                                                       |
| RUN_DATABASE_TESTS / TEST_BASE_URL       | 1 ir testinio serverio adresas, tik izoliuotoms patikroms                                            |

`ELIGIBILITY_MINUTES=30` ir `MOCK_DELIVERY` naujame sraute nenaudojami; tai ankstesnės versijos duomenys. Rezervacijos terminas fiksuotas tiksliai 12 valandų, ne pasirenkamas konfigūracijos parametras.

## Automatiniai testai Codespaces

```bash
npm test
npm run build

# Atskira testinė DB; app DATABASE_URL neliečiama.
docker compose exec db createdb -U contest contest_test
export TEST_DATABASE_URL="$(node --env-file=.env -p 'const u=new URL(process.env.DATABASE_URL);u.pathname="/contest_test";u.toString()')"
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
DATABASE_URL="$TEST_DATABASE_URL" RUN_DATABASE_TESTS=1 npm run test:db
```

Jei contest_test jau egzistuoja, createdb praleiskite. DB testai leidžiami tik *_test bazei ir joje išvalo testinį inventorių / registracijas. Darbinė DB nenulinama. Testuose yra kontroliuojamas laikrodis, konkurencinės transakcijos, tiksli riba, stale formos, restart / nuomos perėmimas, dubliai, saugomas GUID, mismatched atsakymai, audito redakcija ir apsaugotas archyvavimas.

Naršyklės testui atskirame terminale (įprastą demo serverį galima sustabdyti):

```bash
export DATABASE_URL="$TEST_DATABASE_URL"
export RUN_DATABASE_TESTS=1
export APP_ORIGIN="http://localhost:3001"
npm run dev -- --hostname 127.0.0.1 --port 3001 --webpack
```

Kitas terminalas:

```bash
npx playwright install --with-deps chromium
DATABASE_URL="$TEST_DATABASE_URL" RUN_DATABASE_TESTS=1 TEST_BASE_URL=http://localhost:3001 npm run test:browser
```

Chromium diegiamas tik nuotoliniame Codespace, ne įmonės kompiuteryje. Testas naudoja localhost origin; 3001 neturi būti viešas. Ekranvaizdžiai – ignoruojamame test-results aplanke. Naršyklės patikra išvalo tik testinę DB; kitų testų tuo metu nevykdykite.

## Auditas ir atsarginės kopijos

Auditas saugomas PostgreSQL, ne console ir ne viešuose failuose. Nėra viešo jo endpointo. Įprastas admin negali jo keisti; DB triggeris draudžia UPDATE / DELETE. GUID diagnostikai yra prieigos ribojimo objektas, ne autentifikavimo paslaptis. Email, IP ir barcode audit įrašuose yra HMAC žymos, tikri gift kodai ir prisijungimo paslaptys nerašomi.

Produkcinė runtime rolė negali būti DB savininkas / superuser: atskirai suteikti INSERT ir sequence USAGE audit rašymui; SELECT tik IT audit skaitytojui; neleisti DDL / TRUNCATE. Saugojimo terminą ir šifruoto archyvavimo priežiūros procedūrą turi patvirtinti IT. Kol to nėra, auditas netrinamas. Išsamiau – API sutarties dokumente.

Backup į apsaugotą vietą už repo ribų:

```bash
docker compose exec db pg_dump -U contest -d contest -Fc -f /tmp/contest.dump
docker compose cp db:/tmp/contest.dump /jusu/apsaugota/backup/contest.dump
```

Atkūrimą tikrinkite naujoje atskiroje DB. DB volume ir .env / secrets išlaikyti per normalų app / worker restartą; session ir job tapatybė nėra proceso atmintyje.

## Prieš tikrą integraciją

IT turi patvirtinti pirkimo datos / activationDate reikšmę, barcode dalyvavimo tapatybę ir istorinių pirkimų suderinimą, kiekvieno giftId išorinį atitikmenį, endpointus / autentifikavimą, patikimą proxy, idempotency / suderinimo garantijas, gavėjo el. pašto ir consent perdavimą į siuntimo / prenumeratos sistemas. Sutartis ir klaidų klasifikavimas – [docs/API_SUTARTIS_IT.md](docs/API_SUTARTIS_IT.md). Patikros rezultatai – [VERIFICATION.md](VERIFICATION.md). Ankstesnė dokumentacija išsaugota tik istorijai [docs/ANKSTESNE_VERSIJA.md](docs/ANKSTESNE_VERSIJA.md).
