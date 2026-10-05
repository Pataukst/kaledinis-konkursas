# Atlikta patikra

## Dabartinė rezervacijų versija (2026-10-05)

Įgyvendintas trijų ekranų barcode / datos kelias, 12 valandų rezervacijos, patvarus priskyrimo worker, atskiras minutinis valymas, append-only PostgreSQL auditas ir istorijos apsauga. Ankstesni rezultatai žemiau aprašo seną versiją.

| Atlikta patikra | Rezultatas |
| --- | --- |
| npm test | 11 išlaikyta; 2 DB grupės praleistos be RUN_DATABASE_TESTS |
| Vietinis runner .tools/run-checks.cjs: migrate deploy ir test:db atitinkami testų failai su concurrency=1 izoliuotoje contest_test | 26/26 išlaikyta, niekas nepraleista |
| npx tsc --noEmit | Išlaikyta |
| npm run build | Produkcijos Next.js / TypeScript kompiliacija išlaikyta |
| Chromium tests/reservation-smoke.ts su localhost serveriu ir contest_test | Išlaikyta: malformed patikra, barcode / data, 5 dėžutės, nepažymėtas sutikimas, refresh be termino pratęsimo, pending / assigned rezultatas, expiry, neautorizuotas admin / audit, realios reserved / pending / assigned admin būsenos ir archyvavimo apsauga |
| Dvi naujos migrate deploy migracijos | Pritaikytos contest ir contest_test; darbinė DB neatkurta ir nenulinta |

Laikrodis DB testuose valdomas per serverio funkcijų testinę priklausomybę; nėra viešo laikrodžio keitimo parametro. Patikrinta tiksli 12 valandų riba, konkurentų rezervavimas, flow versijų pavėluoti atsakymai, stale ir svetimos sesijos formos, daliniai unikalūs indeksai, normalizuotas email / consent, definitive Failure atkūrimas, timeout prieš / po apdorojimo, stabilus raktas ir payload konfliktas, pending per termino pabaigą, restart / lease perėmimas, pavėluotas worker atsakymas ir review be idempotency garantijos. Audit redakcija bei UPDATE / DELETE ir inventory apsaugos patikrintos tikru PostgreSQL.

Naršyklės expiry fixture paruošta tik *_test bazėje, trumpa transakcija su išimtiniu lentelės užraktu ir laikinai išjungtu istorijos triggeriu; po commit apsauga vėl įjungta. Produkcijos / kliento API tokios galimybės neturi. Mobili sąsaja tikrinta 390 px, admin – darbalaukio lange. Ekranvaizdžiai ignoruojamame test-results aplanke; peržiūrėtas administravimo vaizdas.

**Neatlikta:** Docker / devcontainer build ir pats GitHub Codespaces paleidimas (šiame Windows kompiuteryje Docker nėra), tikros IT API, produkcinis proxy / autentifikavimas, išorinis reconciliation, tikro laiško ar prenumeratos pristatymas, ilgalaikio backup / retention infrastruktūra. Codespaces komandos ir konfigūracija pateiktos README; IT kontrakto nepatvirtintos prielaidos – docs/API_SUTARTIS_IT.md. Jokio viešo diegimo ar ryšio su produkcija nebuvo.

Patikros atliktos 2026-10-04 šiame Windows darbo aplanke.

Aplinka: Node.js 24.21.0, Next.js 16.3.8, Prisma 6.19.3, tikras vietinis PostgreSQL 17.11, Playwright Chromium. Naudotos tik imitacijos ir aiškiai netikri inventoriaus kodai. DB ir naršyklės testai vykdyti atskiroje `contest_test` bazėje.

| Patikra | Rezultatas |
| --- | --- |
| `npm test` | 7 validavimo / adapterių / CSV / produkcijos apsaugos testai išlaikyti; DB grupė sąmoningai praleista be RUN_DATABASE_TESTS |
| `RUN_DATABASE_TESTS=1 npm run test:db` | Visos 7 DB scenarijų patikros išlaikytos (8 testai su pagrindine grupe), niekas nepraleista |
| `npx tsx --env-file-if-exists=.env tests/smoke.ts` | Trys klientų kanalai, klaidingas pirkimas, atskiri pirkėjo ir gavėjo adresai, sutikimas, pasirinkimas Space, penkios dėžutės 390 px ekrane, rezultato perkrovimas, neatskleistas kodas, admin prisijungimas, CSV importas ir archyvavimas, neautorizuotų importo / pašalinimo ir neteisingo Origin blokavimas – išlaikyta |
| `npm run build` | Produkcijos kompiliacija ir TypeScript patikra išlaikytos |
| `npm start -- --hostname 127.0.0.1 --port 3002` ir `tests/production-check.ts` | Produkcijos serveris paleistas, GET allowed=false, mock pirkimo POST atmestas su HTTP 503 |
| `npm run db:migrate` | Abi migracijos pritaikytos tiek vietinei, tiek izoliuotai testinei bazei |
| `npm run seed:dev` | Vietinėje demonstracinėje bazėje įkelti 25 netikri kodai |
| Ekranvaizdžių peržiūra | Peržiūrėtas mobilus dovanų pasirinkimas ir administravimas; dekoracijų sluoksniavimas pataisytas |
| Docker build / Compose | Neatlikta: šiame kompiuteryje Docker nėra |
| Tikros vidinės API / tikro el. laiško pristatymas | Neatlikta: specifikacijos ir integracijos dar nepateiktos |

DB scenarijai tikrina nepatvirtintą / pasibaigusį pirkimą, aštuonis vienu metu konkuruojančius klientus dėl vieno kodo, el. pašto ir pirkimo unikalumą, idempotency, transakcijos atšaukimą, siuntimo klaidą ir pasibaigusios worker nuomos atgavimą tuo pačiu kodu / raktu, tuščią inventorių, CSV atšaukimą ir paskyrimo / archyvavimo lenktynes.

Pirmieji build bandymai aptiko TypeScript klaidas; jos ištaisytos prieš sėkmingą galutinį build. Vienas vėlesnis bandymas negalėjo pakeisti Prisma Windows DLL, kol veikė dev serveris; sustabdžius tą procesą build išlaikytas. Pirmame naršyklės teste per platus alert selektorius sutapo su Next route announcer; selektorius patikslintas ir visos patikros pakartotos sėkmingai.

Tai vietinio veikimo patikra, ne realių API, produkcijos infrastruktūros, didelio srauto ar patvirtintų teisinių dokumentų auditas. Likę paleidimo darbai išvardyti README.
## Papildoma lietuviškų klaidų patikra (2026-10-04)

Po klaidų pranešimų atnaujinimo `npm test` išlaikė 10 testų; DB grupė, kuri šiam kalbos pakeitimui nebuvo vykdoma, sąmoningai praleista. `tests/browser-errors.ts` naršyklėje patikrino lietuviškus kliento ir administravimo tinklo klaidų, netinkamo JSON / serverio atsakymo ir nerasto puslapio pranešimus. `npx next build --webpack` sėkmingai atliko galutinę produkcijos kompiliaciją ir TypeScript patikrą. Prisma schema nekeista, todėl šiame build nebuvo iš naujo generuojamas jau veikiantis klientas.
