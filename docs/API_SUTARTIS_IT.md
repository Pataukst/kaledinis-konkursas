# Siūloma pirkimo ir dovanos priskyrimo sutartis IT

Tai siūloma specifikacija, o ne veikiančių įmonės endpointų aprašas. Programa nekviečia tikrų įmonės sistemų. Tikrieji adapteriai grąžina „nesukonfigūruota“; produkcijoje dalyvavimas ir imitacijos užblokuoti. Gavus IT patvirtinimą, įgyvendinti adapterius `src/lib/assignment-adapters.ts`, išlaikant tipizuotus rezultatus ir `src/lib/api-contract.ts` Zod schemas. Maršrutas turi server-only ribą, darbuotojai naudoja Node modulį; šių modulių neimportuoti į kliento komponentus.

## Darbinės prielaidos, kurias IT turi patvirtinti

1. Vienintelis kliento įvestas laukas „Pirkimo data“ siunčiamas kaip `activationDate`. IT turi patvirtinti, ar pirkimo ir aktyvavimo datos reiškia tą patį. Dabartinė data vietoje jo nesiunčiama.
2. Atsakyme nėra kanoninio pirkimo ID. Dalyvavimo tapatybė – apkarpytas, kaip tekstas saugomas brūkšninis kodas; nuliai ir raidžių registras išlaikomi. Data – patikros duomuo. Datos keitimas negali suteikti antros dovanos. GUID nėra pirkimo ID; skirtingi to paties kliento pirkimai neužblokuojami vien dėl GUID.
3. Sėkmingai patikrinus rezervuojamas vienas atsitiktinis laisvas inventoriaus vienetas tiksliai 12 valandų. Penkios dėžutės yra dekoratyvus pasirinkimas.
4. `Gift.externalGiftId` yra stabilus unikalus vieneto ID, siunčiamas kaip `giftId`. Seniems įrašams migracija priskiria `LOCAL-{esamas id}`; importas priima pasirenkamą unikalų `giftId` stulpelį. Tai vietinis identifikatorius, ne patvirtintas įmonės ID. Pavadinimas, kategorija ir slaptas dovanos kodas nėra šis ID. Prieš integraciją IT turi patvirtinti kiekvieno vieneto atitikmenį.
5. Endpointų URL, autentifikavimas, patikimas proxy, stabilaus idempotency rakto garantija ir neaiškių rezultatų suderinimas dar nepateikti.
6. Priskyrimo užklausa neperduoda gavėjo el. pašto ir naujienlaiškio sutikimo. Jie saugomi vietoje. IT turi apibrėžti, kaip pasirinktas gavėjas patenka į siuntimo ir prenumeratos sistemą. Esamos `DeliveryRequest` / `NewsletterConsentMapping` sąsajos išsaugotos kaip atskiras nebaigtas darbas; naujasis worker nesiunčia laiškų. Trečias endpointas nesugalvotas.

## JSON sutartis

`Content-Type: application/json`; laukų raidžių registras reikšmingas. Boolean yra JSON `true/false`, ne tekstas. UUID turi būti netuščias galiojantis UUID. ID ir brūkšninis kodas – tekstas; data – tikra `YYYY-MM-DD` kalendorinė data, ne vėlesnė nei šiandien Europe/Vilnius. Nenumatyta nei kampanijos datų, nei brūkšninio kodo formato taisyklė; maksimalus kodo ilgis 128 simboliai.

Patikra:

```json
{
  "customerIp": "203.0.113.42",
  "barcode": "0001234567890",
  "activationDate": "2026-10-01"
}
```

Galiojantis pirkimas:

```json
{ "validation": true, "customerGuid": "3f48aeb7-0718-4a6a-a21e-3b2e6c7d80a9" }
```

Negaliojantis pirkimas:

```json
{ "validation": false, "customerGuid": null, "errorCode": "PURCHASE_NOT_VALID" }
```

Priskyrimas siunčiamas tik po vietinio transakcijos commit; jokia DB transakcija nelaikoma per tinklo užklausą:

```json
{
  "customerGuid": "3f48aeb7-0718-4a6a-a21e-3b2e6c7d80a9",
  "giftId": "DEMO-GIFT-0001"
}
```

Antraštė `Idempotency-Key: assignment:{claim UUID}` stabili visiems pakartojimams, restartams ir nuomos perėmimams. IT turi grąžinti pradinį rezultatą tam pačiam raktui; kito GUID / dovanos payload su tuo pačiu raktu turi būti atmestas. Reikia patvirtinti, kiek laiko raktas ir rezultatas išsaugomi. Jie turi išlikti bent iki galutinio suderinimo, ne vien iki 12 valandų termino.

Patvirtintas rezultatas:

```json
{
  "status": "OK",
  "customerGuid": "3f48aeb7-0718-4a6a-a21e-3b2e6c7d80a9",
  "giftId": "DEMO-GIFT-0001"
}
```

Tik garantuotas nepriskyrimas:

```json
{ "status": "Failure", "errorCode": "ASSIGNMENT_REJECTED", "retryable": false }
```

`OK` priimamas tik kai abu echoed ID tiksliai sutampa su saugomais siųstais laukais. GUID imamas iš nekintamos patikra → rezervacija → registracija grandinės, niekada iš naršyklės. Nesutapimas arba netaisyklingas JSON palieka dovaną apsaugotą peržiūrai. `OK` nereiškia laiško pristatymo.

## Klaidų ir HTTP apdorojimas būsimoje HTTP integracijoje

| Atsakymas / situacija                             | Klasifikacija ir veiksmas                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Galiojantis 2xx ir validation=false               | Verslo patikros atmetimas, lietuviškas pirkimo duomenų pranešimas; inventorius neliečiamas      |
| Blogas JSON, string boolean, netuščio UUID nėra   | Patikros paslaugos klaida; dovana nerezervuojama                                                |
| HTTP 400/401/403/404                              | Sutarties / autentifikavimo / konfigūracijos klaida; tai savaime nėra garantuotas nepriskyrimas |
| HTTP 429                                          | Throttling; paisyti riboto Retry-After ir kartoti tik saugiu tuo pačiu raktu                    |
| HTTP 5xx, ryšio nutrūkimas, timeout               | Patikrai – paslauga neprieinama; priskyrimui – neaiški baigtis, dovana saugoma                  |
| Galiojantis sutartinis Failure su retryable=false | IT garantuoja, kad joks priskyrimas neįvyko; automatiškai nekartoti                             |
| OK su kitu GUID ar giftId                         | Neaiški baigtis, auditas ir IT peržiūra; dovanos neatlaisvinti                                  |

Vien HTTP klaidos kodas ar timeout neįrodo nepriskyrimo. Net 2xx su netaisyklingu kūnu negali būti laikomas sėkme. Klientui nerodomi vidiniai tekstai, URL ar diagnostikos payload. Šioje versijoje HTTP transportas dar neįjungtas; minėtas susiejimas yra reikalavimas būsimam tikram adapteriui.

## Gyvavimo ciklas ir atmetimo atkūrimas

`AVAILABLE → RESERVED → PENDING_ASSIGNMENT → ASSIGNED`. Rezervacijos `reservedAt` ir `expiresAt` yra DB laiko UTC momentai, tarp jų lygiai 12 valandų. Ekranas rodo Europe/Vilnius. Užklausos serializuojamos PostgreSQL advisory ir eilučių užraktais; daliniai unikalūs indeksai draudžia aktyvius dublius. Užrakto laukimo klaida nėra inventoriaus išsekimas.

`RESERVED` pasibaigia kai `expiresAt <= DB laikas`: įrašas tampa EXPIRED, aktyvios dovanos nuorodos ir data išvalomos, vienetas grąžinamas į laisvus, flow patvirtinimas panaikinamas. Senos istorijos datos lieka. Kiekviena susijusi operacija tikrina terminą, o darbuotojas išvalo ir apleistas sesijas. Grįžimas atgal atlaisvina tik tos sesijos nebaigtą rezervaciją; refresh jos neatlaisvina. Nauja sesija negali perimti rezervacijos žinodama ID.

Galutinis patvirtinimas iki termino atomiškai išsaugo normalizuotą gavėjo adresą, dėžutę, sutikimo tekstą / versiją / laiką ir užduotį. Pending niekada neatlaisvinamas dėl 12 valandų termino. Unikalūs email / barcode / inventoriaus indeksai apima pending ir assigned; rejection istorijai netaikomi. Ankstesnės Claim eilutės ir jų el. pašto apribojimas išlieka; žinomi ankstesni `fixture:barcode` įrašai taip pat blokuoja tą brūkšninį kodą. Nepatvirtintas senų kitokio formato pirkimų atitikmenų suderinimas lieka IT sprendimas.

Garantavus Failure, registracija tampa REJECTED, job – rejected. Rezervacija atkuriama su originaliu terminu; jei terminas jau praėjo, ji iškart tampa EXPIRED. Kartojant tą patį kliento requestKey grąžinamas ankstesnis REJECTED, be API užklausos. Norint taisyti registraciją, refresh grąžina į formą ir sukuria naują requestKey; email/barcode indeksai leidžia naują bandymą. Neaiškioms baigtims šis kelias netaikomas.

Timeout / ryšio klaidos kartojamos tik esant `EXTERNAL_IDEMPOTENCY_CONFIRMED=true`. Be patvirtintos garantijos rezultatas saugomas `review`. Nesutapimai ir netaisyklingi atsakymai taip pat iškart `review`. Pasiekus maksimalų bandymų skaičių būsena `review`, o ne dovanos atlaisvinimas. Admin mato saugią priežastį ir bandymų skaičių; automatinio pavojingo „atlaisvinti“ mygtuko nėra. IT turi suderinti rezultatą su išorine sistema prieš bet kokį rankinį sprendimą.

## Kliento IP ir sesijos

Klientas negali pateikti `customerIp`. Next Route Handler neturi tiesioginio socket IP. Įmonės ingress turi pašalinti kliento pateiktą `X-Contest-Client-IP` ir įrašyti patikrintą socket arba patikimo ankstesnio proxy IP. Next serveris turi būti pasiekiamas tik per tą ingress, ne tiesiogiai. Tik tada nustatyti `TRUSTED_CUSTOMER_IP_HEADER=x-contest-client-ip`. Neribotų `X-Forwarded-For` ir `X-Real-IP` antraščių programa neskaito.

Codespaces / vietos imitacijoje, kai šis kintamasis tuščias, siunčiamas aiškus techninis `127.0.0.1` fixture, ne tariamas tikras lankytojo IP. Codespaces forwarding nėra patvirtintas įmonės proxy. Tikro adapterio IP fallback nėra; integracija lieka užblokuota.

Cookie – atsitiktinis 256 bitų opaque token, HttpOnly, SameSite=Lax, Secure produkcijoje; DB saugomas jo hash. Sesija galioja 24 valandas, taigi ne trumpiau už rezervaciją. Įprasti app / worker restartai nepakeičia cookie ar flow. Duomenų pakeitimai turi DB flow versiją; pavėluotas API atsakymas negali perrašyti naujesnio patvirtinimo. IP nėra autentifikavimo tapatybė.

## Auditas, teisės ir saugojimas

`AuditEvent` yra PostgreSQL append-only lentelė: UPDATE ir DELETE uždrausti triggeriu; viešo audito endpointo ir admin redagavimo nėra. Kiekviena būsena ir su ja susijęs auditas įrašomi toje pačioje transakcijoje; API bandymas ir rezultatas turi bendrą correlation UUID. Audit timestamp UTC duoda DB; metadata – serverio struktūruotas JSON, ne vartotojo suformuota log eilutė.

Saugomi grandinės ID, riboto naudojimo GUID, būsenos, rezervacijos pradžia / pabaiga, trukmė, bandymo numeris ir saugi klaidos klasė. Email / IP / barcode užmaskuojami HMAC su `AUDIT_HMAC_KEY`, dovanos kodai ir slaptažodžiai / antraštės / cookie / token neįrašomi. Tikslūs barcode ir email lieka tik veiklai reikalingose apsaugotose registracijos lentelėse; ne papildomuose diagnostikos dumpuose. Diagnostinių tikslių payload archyvo ši versija nekuria. Jei jo reikės, IT turi parengti atskirą autentifikuotą, šifruotą serverio saugyklą, raktą ne DB ir patvirtintą retention.

Kūrimo Docker DB savininkas nėra tinkama produkcijos programos rolė. Produkcijoje atskirti migracijų savininką, runtime ir audit skaitytoją. Runtime suteikti tik reikalingas duomenų lentelių DML teises, `AuditEvent` INSERT ir sekos USAGE; nesuteikti audit SELECT/UPDATE/DELETE/TRUNCATE, DDL ar superuser. Audit skaitytojui – tik SELECT. Įprastas admin endpointas šių teisių nekeičia. Migracijų owner gali pakeisti triggerius, todėl jo slaptažodis neturi būti app / worker konfigūracijoje.

`AUDIT_RETENTION_DAYS` nurodo minimalią audito saugojimo trukmę metaduomenyse (numatyta 365 dienos). App ir worker niekada netrina audito. IT patvirtinta priežiūros procedūra po šio termino gali archyvuoti į apsaugotą šifruotą saugyklą ir atlikti savininko valdomą pašalinimą; negalima automatiškai ištrinti neišspręstų priskyrimų istorijos. Konfigūracijos pakeitimas neveikia jau įrašytų saugojimo terminų. Backup retention turi apimti tuos pačius reikalavimus. Tol, kol archyvavimo procedūra nepatvirtinta, saugoma neribotai.

DB Docker `database` tome saugomi ir rezervacijos, ir eilė, ir audit; nesaugoti vien container failuose. Atsarginės kopijos – `pg_dump -Fc`, atkūrimą tikrinti atskiroje DB. Backup su asmens duomenimis nelaikyti repo ar viešuose kataloguose.

## Deterministinės imitacijos ir JSON fixture

`tests/fixtures/*.json` – pakartotinai naudojami užklausų / atsakymų pavyzdžiai, tikrinami Zod testuose. TEST-001…TEST-009 ir 0001234567890 galioja tik imitacijoje; GUID deterministiškai gaunamas iš barcode, nesikeičia nuo datos ar proceso restartų. INVALID atmetamas; MALFORMED, TIMEOUT, UNAVAILABLE parodo paslaugos klaidas. Tai ne tikrų barcode formato taisyklės.

`MOCK_ASSIGNMENT`: ok, failure, timeout-before, timeout-after, malformed, swapped-guid, swapped-gift. Imitacijos key/payload/response išsaugomi `MockAssignment` DB lentelėje; kito payload su tuo pačiu raktu nepriskiriama, tam pačiam vienetui antras priskyrimas atmetamas. timeout-after pirmas bandymas išsaugo OK, bet praranda atsakymą; kitas darbuotojo bandymas tuo pačiu raktu gauna ankstesnį OK. Demo nesuteikia tikrų dovanų ir nesiunčia tikrų laiškų.
