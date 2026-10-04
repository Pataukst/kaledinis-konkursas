# Kalėdinės dovanos konkursas

Veikianti vietinė Next.js / TypeScript programa su tikru PostgreSQL, Prisma migracijomis, keturiais dalyvavimo žingsniais, apsaugotu `/admin` ir patvaria siuntimo užduočių eile. Kliento sąsaja ir pranešimai lietuviški. Penkios dėžutės yra tik vizualus pasirinkimas: dovana paskiriama tik patvirtinus galutinę registraciją.

## Darbas VS Code

Reikia **Node.js 24 LTS**, npm ir PostgreSQL 17 arba Docker Compose. Atverkite šį aplanką per **File → Open Folder** ir integruotą terminalą. Priklausomybių versijos užfiksuotos `package-lock.json`; naudokite `npm ci`.

Naujam kompiuteriui (PowerShell):

```powershell
Copy-Item .env.example .env
# .env nustatykite POSTGRES_PASSWORD ir atitinkamą DATABASE_URL.
# Vietinės pavyzdinės reikšmės nėra produkcijos slaptažodžiai.
docker compose up -d db
npm ci
npm run db:migrate
npm run seed:dev
npm run admin:create
npm run dev
```

Antrame terminale:

```powershell
npm run worker
```

Atverkite `http://localhost:3000`, administravimas – `http://localhost:3000/admin`. Administratoriaus kūrimo komanda interaktyviai prašo vardo ir 14–200 simbolių slaptažodžio; slaptažodis nerodomas ir neperduodamas komandų eilutėje. Viešos registracijos nėra. Nėra numatytojo administratoriaus ar produkcijos paskyros. Naudokite tik savo slaptažodį.

### Šiame darbo aplanke paruošta vietinė aplinka

Šio įgyvendinimo metu Node ir Docker nebuvo PATH. Patikrai atsisiųstas Node 24.21.0 ir PostgreSQL 17.11 į `%LOCALAPPDATA%\contest-tools`. PostgreSQL klausosi tik `127.0.0.1:55432`. `.env` jau turi atsitiktinį vietinį slaptažodį, o `contest` ir `contest_test` bazės migruotos. Neperrašykite šio `.env` pavyzdžiu, jei norite naudoti paruoštą bazę.

```powershell
$env:PATH = "$env:LOCALAPPDATA\contest-tools\node-v24.21.0-win-x64;" + $env:PATH
npm run seed:dev
npm run admin:create
npm run dev
```

Jei vietinis PostgreSQL po kompiuterio perkrovimo sustabdytas:

```powershell
& "$env:LOCALAPPDATA\contest-tools\pgsql\bin\pg_ctl.exe" -D "$env:LOCALAPPDATA\contest-tools\pgdata" -l "$env:LOCALAPPDATA\contest-tools\postgres.log" -o '-p 55432 -h 127.0.0.1' -w start
```

Sustabdymas:

```powershell
& "$env:LOCALAPPDATA\contest-tools\pgsql\bin\pg_ctl.exe" -D "$env:LOCALAPPDATA\contest-tools\pgdata" -m fast -w stop
```

Ši nešiojama patikros aplinka nėra produkcijos infrastruktūra. `.tools`, `.env`, naršyklės rezultatai ir duomenų katalogas nepatenka į Git ar Docker atvaizdą.

## Vietiniai testiniai pirkimai

Abu adapteriai turi būti `mock`. Klientui rodoma: „Demonstracinis režimas: pirkimai tikrinami pagal testinius duomenis, el. laiškai nesiunčiami.“

| Kanalas               | Duomenys                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| Internete             | Užsakymas `TEST-001` … `TEST-009`; bet kuris sintaksiškai tinkamas pirkėjo el. paštas |
| Mūsų parduotuvėje     | Brūkšninis kodas `TEST-001` … `TEST-009`; kvitas `000123`                             |
| Pas prekybos partnerį | Tas pats testinis kodas; tikra data, ne vėlesnė už šiandien Lietuvoje                 |

Tas pats `TEST-001` visais kanalais grąžina tą patį `fixture:TEST-001` pirkimo ID. Taip galima tikrinti pakartotinį pirkimą tarp kanalų. Kiti numeriai (pvz., `INVALID`) negalioja. `TIMEOUT` imituoja tikrinimo laiko viršijimą, `UNAVAILABLE` – neprieinamą paslaugą; abu palieka klientą antrame žingsnyje. Imitacijos rezultatai deterministiniai, tinklas nekviečiamas. Šios reikšmės nėra tikrų užsakymų ar brūkšninių kodų formatų taisyklės.

`MOCK_DELIVERY=accepted` reiškia tik imituotą užklausos priėmimą. `MOCK_DELIVERY=failed` sukuria pakartojamą siuntimo klaidą. Pakeitus reikšmę perkraukite worker procesą. `seed:dev` įkelia 25 **netikrus** `FAKE-…` kodus tik aiškiai paleidus komandą; ji draudžiama produkcijoje. Automatinio produkcijos duomenų užpildymo nėra.

Pirkėjo ir gavėjo el. paštai gali skirtis. Gavėjo adresas apkarpomas ir paverčiamas mažosiomis raidėmis; taškai ir `+` dalys nekeičiami. Apribojimas galioja adresui, o ne įrodytai unikaliai fizinio asmens tapatybei. Sintaksės patikra neįrodo, kad pašto dėžutė egzistuoja.

## Docker Compose

Visam **vietiniam demonstraciniam** rinkiniui naudokite `.env.example` pagrindu paruoštą `.env` su PostgreSQL slaptažodžiu:

```powershell
docker compose -f compose.yaml -f compose.dev.yaml up --build -d
docker compose -f compose.yaml -f compose.dev.yaml exec app npm run seed:dev
docker compose -f compose.yaml -f compose.dev.yaml exec app npm run admin:create
```

Compose viduje `DATABASE_URL` nustatomas į `db:5432`; slaptažodžiui rinkitės URL tinkamą atsitiktinę reikšmę, pvz., šešioliktainę. Duomenys lieka `database` tome. Migracijų paslauga baigiasi prieš app ir worker paleidimą. `compose.dev.yaml` aiškiai įjungia kūrimo režimą; jo nenaudokite viešam paleidimui.

Produkcijos atvaizdo sukūrimas ir paslaugų paleidimas:

```powershell
docker compose build
docker compose up -d
```

**Šiuo metu produkcijoje dalyvavimas sąmoningai užblokuotas.** Tikrieji adapteriai nesukonfigūruoti, o imitacijos produkcijoje neleidžiamos. Worker tokiu atveju baigiasi klaida. Vien aplinkos kintamojo pakeitimas negali apeiti šios apsaugos. Produkcijos paleidimas bus galimas tik įgyvendinus ir patikrinus tikras vidines integracijas bei atnaujinus `participationAllowed` funkciją.

Be Docker:

```powershell
npm ci
npm run db:migrate
npm run build
npm start
# Atskirame procese, po integracijų įgyvendinimo:
npm run worker
```

IT turi skelbti svetainę klientams prieinamu HTTPS adresu per reverse proxy, nukreipiantį į app. `APP_ORIGIN` turi tiksliai atitikti viešą protokolą ir domeną. Compose app prievadas pagal nutylėjimą susietas su loopback; jei proxy kitame serveryje, IT turi sąmoningai pakeisti susiejimą ir ugniasienę. PostgreSQL, worker ir vidinių API prieiga turi likti privačioje infrastruktūroje. Naršyklė vidinių API nekviečia. Galima papildomai apriboti `/admin` per įmonės VPN/proxy. Slapukai produkcijoje `Secure`, `HttpOnly`, su `SameSite` apsauga. POST tikrina `Origin`. Nereikia viešai skelbti DB prievado.

## Aplinkos kintamieji

| Kintamasis                | Paskirtis / numatytoji reikšmė                                                  |
| ------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Serverio PostgreSQL prisijungimas; būtinas                                      |
| `POSTGRES_PASSWORD`       | Compose PostgreSQL slaptažodis; būtinas Compose                                 |
| `APP_ORIGIN`              | Tikslus leidžiamas svetainės adresas, vietoje `http://localhost:3000`           |
| `PURCHASE_ADAPTER`        | `mock` arba `real`; nežinoma / trūkstama reikšmė niekada nepaleidžia imitacijos |
| `DELIVERY_ADAPTER`        | `mock` arba `real`; tikras adapteris kol kas grąžina `unconfigured`             |
| `MOCK_DELIVERY`           | `accepted` arba `failed`, tik kūrimo aplinkai                                   |
| `ELIGIBILITY_MINUTES`     | Patvirtinto pirkimo galiojimas, 30, daugiausia 1440                             |
| `IDENTIFIER_MAX_LENGTH`   | Užsakymo / kvito / brūkšninio kodo ilgis, 128, daugiausia 1024                  |
| `CSV_MAX_BYTES`           | CSV UTF-8 dydis, 1048576, daugiausia 10000000                                   |
| `CSV_MAX_ROWS`            | CSV eilučių skaičius, 5000, daugiausia 100000                                   |
| `CONSENT_TEXT`            | Patvirtintas lietuviškas sutikimas; pradinė demonstracinė formuluotė            |
| `CONSENT_VERSION`         | Sutikimo versija, `dev-1`; keičiant tekstą pakeisti ir versiją                  |
| `ORGANISER_TEXT`          | Patvirtinta organizatoriaus informacija; pradžioje aiškus kūrimo vietaženklis   |
| `RULES_URL`               | Patvirtintų taisyklių nuoroda; tuščia reikšmė rodo vietaženklį                  |
| `PRIVACY_URL`             | Patvirtintos privatumo informacijos nuoroda; pradžioje tuščia                   |
| `INTERNAL_API_TIMEOUT_MS` | Siuntimo bandymo terminas, 10000, daugiausia 60000 ms                           |
| `DELIVERY_MAX_ATTEMPTS`   | Siuntimo bandymai, 8, daugiausia 100                                            |
| `WORKER_POLL_MS`          | Tuščios eilės patikros intervalas, 1000, daugiausia 60000 ms                    |
| `NODE_ENV`                | Next automatiškai: development su dev, production su build/start                |
| `NEXT_TELEMETRY_DISABLED` | Galima nustatyti `1`, kad Next nesiųstų naudojimo statistikos                   |
| `RUN_DATABASE_TESTS`      | `1` leidžia tik izoliuotus DB/naršyklės testus                                  |
| `TEST_BASE_URL`           | Naršyklės testo svetainė, `http://localhost:3001`                               |

API URL ir autentifikacijos kintamieji dar neapibrėžti: jų neinventuojame iki tikros specifikacijos. Visos paslaptys laikomos serverio aplinkoje. Nenaudoti `NEXT_PUBLIC_` DB ar API paslaptims. `.env` negalima įkelti į Git, siųsti su atvaizdu ar kopijuoti į kliento komponentus.

## Paskyrimas, siuntimas ir pakartojimai

`src/lib/claims.ts` patikrina serverio sesijos patvirtinimą, jo galiojimą, el. paštą, dėžutę ir teigiamą sutikimą. Įrašomas tik faktiškai parodytas, su dabartine patvirtinta konfigūracija sutampantis sutikimo tekstas ir versija. Kliento `purchaseId` ar `validated=true` neturi jokios galios. Grįžimas atgal panaikina patvirtinimą. Naujas tikrinimas iš karto panaikina ankstesnio galiojimą; pavėluotas senas atsakymas negali perrašyti naujo tikrinimo.

Transakcija užrakina sesiją ir bendrą inventoriaus patariamąjį užraktą, tada `ORDER BY random()` vienodomis tikimybėmis parenka vieną laisvą kodą. Kiekvienas kodas turi vienodą galimybę; pavadinimas, turintis daugiau kodų, dažniau laimi. Dėžutės numeris tikimybės nekeičia. Paskyrimas, registracija, sutikimas ir siuntimo užduotis įrašomi kartu. Duomenų bazė papildomai užtikrina unikalias el. pašto, pirkimo ir dovanos sąsajas. Užrakto konfliktai turi ribotą pakartojimą; tikras inventoriaus išsekimas atskiriamas nuo laikino užimtumo. Šis paprastas bendras užraktas tinka mažam konkursui; didelį srautą prieš paleidimą būtina išmatuoti.

Ta pati sesija ir tas pats UUID užklausos raktas grąžina tą patį rezultatą. Pakeisti kartojimo duomenys atmetami. Naujas bandymas panaudotu el. paštu arba pirkimu atmetamas. Kitos sesijos dalyvio duomenys negrąžinami. Rezultato perkrovimas tik perskaito registraciją, nesukuria siuntimo ir neatskleidžia kodo.

`src/lib/outbox.ts` atominiu `UPDATE … FOR UPDATE SKIP LOCKED` paima vieną užduotį ir suteikia terminuotą nuomą. Išorinis kvietimas vykdomas po paskyrimo transakcijos. Nuomos žetonas apsaugo įrašą nuo pavėluoto worker rezultato. Terminas ir ribotas eksponentinis atidėjimas neleidžia nuolat suktis klaidoms. Po bandymų limito užduotis lieka `failed`. Ji niekada nepakeičia paskirtos dovanos ir negrąžina kodo į fondą.

„Accepted“ reiškia **vidinės API priimtą užklausą**, ne įrodytą el. laiško pristatymą. Po neaiškaus laiko viršijimo kvietimas gali būti kartojamas; vidinė sistema privalo gerbti tą patį `idempotencyKey`, kad nesukurtų dviejų el. laiškų. Kol to nepatvirtina dokumentacija, negalima žadėti exactly-once el. pašto pristatymo. Vietinė programa garantuoja vieną dovanos paskyrimą. Būsimame realiame HTTP adapteryje naudokite `AbortSignal.timeout`, saugų atsakymo validavimą ir nekeiskite serverio adresų pagal kliento įvestį.

Po vidinės paslaugos atstatymo nepavykusią užduotį galima pakartoti per autentifikuotą `/api/admin` POST su `{ "action": "retry", "jobId": "…" }`. Reikia galiojančio admin slapuko ir teisingo `Origin`. Užduoties ID nustato administratorius privačioje DB; viešame rezultate jo nėra. API atstato tik `failed` užduotį; gavėjas, kodas ir idempotency raktas išlieka. Produkcijoje stebėkite `failed` / užstrigusias užduotis ir worker būseną.

## Administravimas ir CSV

CSV antraštės: `dovanos_kodas,dovanos_pavadinimas`. Šablonas yra `public/dovanu-sablonas.csv` ir atsisiunčiamas administravime. Palaikomi UTF-8, BOM, kablelis arba kabliataškis, kabutės ir kabutėse esantys eilučių lūžiai. Kodai visada tekstiniai, pradiniai nuliai išsaugomi.

Peržiūra rodo bendrą eilučių skaičių ir konkrečių eilučių klaidas; lentelėje pirmos 100 eilučių, validuojamas visas failas. Tušti laukai, klaidingos antraštės, neteisingos eilutės, pasikartojimai faile ir visi jau buvę kodai (įskaitant archyvuotus) atmetami. Importas tik po patvirtinimo ir tik visas vienoje transakcijoje; esamų kodų ir pavadinimų nepakeičia.

Pašalinimas yra **laisvų kodų archyvavimas**, ne fizinis jų ištrynimas. Patvirtinime rodomas pasirinktų eilučių skaičius; serveris atominiu būdu iš naujo patikrina būseną. Paskirtos dovanos ir registracijos apsaugotos. Archyvuoti kodai neimportuojami dar kartą. Grąžinami pašalintų ir apsaugotų / praleistų įrašų skaičiai.

## Patikra

```powershell
npm test
npm run build
```

DB testai tyčia atsisako veikti bazėje, kurios pavadinimas nesibaigia `_test`. Jie **išvalo tik tą izoliuotą bazę**, todėl niekada nenaudokite klientų duomenų turinčios testinės bazės.

```powershell
# Sukurkite tuščią contest_test bazę tuo pačiu PostgreSQL naudotoju.
$env:DATABASE_URL = ((Get-Content .env | Where-Object { $_ -like 'DATABASE_URL=*' }) -replace '^DATABASE_URL=', '') + '_test'
$env:RUN_DATABASE_TESTS = '1'
npm run db:migrate
npm run test:db
```

Naršyklės testai: pirmame terminale nustatykite tą patį testinės DB URL ir `APP_ORIGIN`, paleiskite serverį:

```powershell
$env:DATABASE_URL = ((Get-Content .env | Where-Object { $_ -like 'DATABASE_URL=*' }) -replace '^DATABASE_URL=', '') + '_test'
$env:APP_ORIGIN = 'http://localhost:3001'
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Antrame terminale:

```powershell
$env:DATABASE_URL = ((Get-Content .env | Where-Object { $_ -like 'DATABASE_URL=*' }) -replace '^DATABASE_URL=', '') + '_test'
$env:RUN_DATABASE_TESTS = '1'
npx playwright install chromium
npx tsx --env-file-if-exists=.env tests/smoke.ts
```

Testas tikrina visus tris kanalus, klaidingo pirkimo blokavimą, skirtingus pirkėjo/gavėjo adresus, sutikimą, penkias mobiliame ekrane matomas dėžutes, pasirinkimą klaviatūra, rezultato perkrovimą be naujo paskyrimo, neatskleistą kodą, administravimą, CSV importą / archyvavimą ir CSRF. Laikina admin paskyra sukuriama atsitiktiniu slaptažodžiu ir po patikros pašalinama; jos duomenys nespausdinami. Ekranvaizdžiai `test-results/` nepatenka į Git. Nekvieskite DB ir browser testų vienu metu, nes jie dalijasi testine baze.

Rankinė papildoma patikra: išbandykite `TIMEOUT`, `UNAVAILABLE`, grįžimą atgal ir pakeistus pirkimo duomenis, pasibaigusį 30 min. patvirtinimą, jau panaudotą email / pirkimą, tuščią inventorių, `MOCK_DELIVERY=failed`, worker stabdymą ir paleidimą, CSV BOM ir kabutes, prieš pat ištrynimą paskirtą kodą, mobilią 320 px pločio sąsają. Patikrinkite realių API saugų klaidų susiejimą gavę specifikacijas.

Faktiškai paleistų patikrų rezultatai pateikiami `VERIFICATION.md`. Docker patikra šiame kompiuteryje neatlikta, nes Docker neįdiegtas.

## Atsarginės kopijos ir atkūrimas

Reguliariai darykite šifruotas kopijas, ribokite prieigą ir praktiškai tikrinkite atkūrimą. PostgreSQL custom-format kopija Compose aplinkoje (be PowerShell dvejetainio srauto peradresavimo):

```powershell
docker compose exec db pg_dump -U contest -d contest -Fc -f /tmp/contest.dump
docker compose cp db:/tmp/contest.dump ./contest.dump
```

Atkūrimą tikrinkite į **atskirą** tuščią bazę, sustabdę ją naudojančius procesus:

```powershell
docker compose exec db createdb -U contest contest_restore
docker compose cp ./contest.dump db:/tmp/contest.dump
docker compose exec db pg_restore -U contest -d contest_restore --no-owner /tmp/contest.dump
```

Patikrinę atkurtą kopiją IT gali suplanuoti kontroliuojamą pakeitimą. Nenaudokite `--clean` veikiančioje klientų bazėje. Kopijose yra el. paštai, sutikimai ir dovanų kodai: jų neskelbti ir nelaikyti repozitorijoje.

## Ką būtina užbaigti prieš tikrą paleidimą

1. `src/lib/adapters.ts`: įgyvendinti `realPurchase` pagal tikrą endpointą, autentifikaciją ir schemą. Reikia stabilaus kanoninio pirkimo ID bei aiškaus valid/invalid rezultato. Tikras unikalumas tarp kanalų priklauso nuo šio bendro ID; programa negali jo atspėti.
2. Tame pačiame faile įgyvendinti `realDelivery`, susiejant `recipientEmail`, `giftCode`, `claimId`, `idempotencyKey` su tikra sutartimi. Patvirtinti vidinės sistemos idempotency palaikymą, terminus, saugų kartojimą ir klaidų kodus. Svetainė nesiunčia per kitą el. pašto tiekėją.
3. Dokumentuoti ir įgyvendinti `NewsletterConsentMapping` pagal vidinės naujienlaiškių sistemos specifikaciją. Įrašytas sutikimas dabar nereiškia įtraukimo į išorinę platformą. Jei sinchronizacijai reikia patikimos užduoties, pridėti atskirą patvarią eilę / migraciją.
4. `src/lib/config.ts`: tik įgyvendinus abi integracijas įjungti dalyvavimą real režimu ir produkcijoje, išlaikant mock blokavimą. Papildyti `.env.example` ir README tikrais serverio konfigūracijos kintamaisiais, be kredencialų. Paleisti produkcijos blokavimo ir integracijų testus.
5. Patvirtinti organizatoriaus informaciją, taisykles, privatumo nuorodą ir sutikimo tekstą / versiją. Nenustatyti kampanijos datų, prizų verčių ar teisinių sąlygų be užsakovo patvirtinimo.
6. Atskirai patvirtinti asmens duomenų ir atsarginių kopijų saugojimo terminus bei teisėtą sutikimo saugojimo / pašalinimo procesą. Inventoriaus archyvavimas nėra klientų duomenų ištrynimas. Ši programa sąmoningai nenustato neriboto teisėto saugojimo termino.
7. IT: HTTPS, vieša klientų prieiga, privati DB ir vidiniai API, saugus paslapčių tiekimas, atsarginės kopijos, worker / klaidų stebėjimas ir papildomi proxy srauto limitai. Dabartiniai DB limitai: 20 contest POST / sesiją / min., 300 bendrų contest POST / min., 1200 sesijos skaitymų / min.; admin prisijungimai 5 / vardą ir 20 bendrai per 15 min.; admin operacijos 30 / paskyrą / min. Netikėti srautai nepasitikimi `X-Forwarded-For`; patikimų proxy IP limitus sukonfigūruoja IT.

## Klaidų pranešimų kalba

Bendroji Zod validavimo kalba – lietuvių; laukams taikomi konkretūs lietuviški pranešimai. Kliento ir administravimo tinklo bei netinkamo serverio atsakymo klaidos apdorojamos `src/lib/client-errors.ts`, komandų klaidos – `src/lib/cli-errors.ts`. Nežinomos techninės išimtys nerodomos dalyviui. Nerastas puslapis ir netikėtos puslapio / pagrindinio išdėstymo klaidos taip pat pateikiamos lietuviškai.

Paleidus vietinę svetainę, papildoma naršyklės patikra:

```powershell
npx tsx tests/browser-errors.ts
```