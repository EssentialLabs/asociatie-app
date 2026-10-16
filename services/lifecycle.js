/**
 * services/lifecycle.js
 *
 * Monthly Financial Lifecycle Service matching FoxPro TRE.PRG, GOL.PRG, and SLU.PRG.
 * Operations:
 * - publishMonth (TRE.PRG): Freezes snapshots into apartamente_luna / blocuri_luna / asociatie_luna,
 *   books non-zero R, F, A rows into `datorii`, sets period status to 'PUBLICATA'.
 * - unpublishMonth (GOL.PRG): Strictly guarded by 0 payments against the period; deletes published
 *   `datorii` rows and reverts period status to 'DESCHISA'.
 * - closeMonth (SLU.PRG): Snapshots state, rotates apartment & block meter/allocator indices
 *   (IV = IN, IN = 0), zeroes monthly charges & invoices, preserves settings & recurring fields,
 *   opens next working period ('DESCHISA').
 * - reopenMonth: Audited rollback restoring state from immutable snapshots.
 */

const { getDb } = require('../db');
const { calculatePeriod, round2 } = require('../engine/calcul');
const { getPeriodCalculationData, savePeriodCalculationData, LUNI_RO } = require('./ledger');
const { syncApartmentScalars } = require('./cashier');

function resolveDbAndOptions(arg1, arg2 = {}) {
  if (arg1 && typeof arg1.prepare === 'function') {
    if (typeof arg2 === 'number' || typeof arg2 === 'string') {
      return { d: arg1, options: { periodId: Number(arg2) } };
    }
    return { d: arg1, options: arg2 || {} };
  }
  const d = getDb();
  if (typeof arg1 === 'number' || typeof arg1 === 'string') {
    return { d, options: { ...arg2, periodId: Number(arg1) } };
  }
  return { d, options: arg1 || {} };
}

function getLastDayOfMonthIso(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Writes immutable snapshots for apartamente_luna, blocuri_luna, and asociatie_luna.
 */
function writePeriodSnapshots(d, period, asociatie, blocuri, apartamente) {
  const delAptSnap = d.prepare('DELETE FROM apartamente_luna WHERE perioada_id = ?');
  const delBlocSnap = d.prepare('DELETE FROM blocuri_luna WHERE perioada_id = ?');
  const delAsocSnap = d.prepare('DELETE FROM asociatie_luna WHERE perioada_id = ?');

  delAptSnap.run(period.id);
  delBlocSnap.run(period.id);
  delAsocSnap.run(period.id);

  const insBlocSnap = d.prepare(`
    INSERT INTO blocuri_luna (
      perioada_id, bloc_id, an, luna, bloc, strada, numar, cod, cod_postal,
      total_apartamente, suprafata_totala,
      mod_r_dif, mod_r_inc, modr_difin, mod_r_asc,
      proc_av_ac, proc_av_in, procinccom, proc_sal_f, proc_sal_t, proc_abona, proc_chadm, procgunoi, proc_chsed,
      inar, ivar, cp_ar, inac, ivac, cp_ac, inin, ivin, constin, cp_in,
      ecart_temp, rand_tr, tarif_et,
      gaz, gunoi, curent, curent_sc, curent_li, ascensor, sal_tesa, sal_feme, ch_admin, ch_sediu,
      cota_fr, prest_serv, chelt_inc, abonament, can_met,
      difarar, difarac, difcanar, difcanac, difetac, difetin,
      arac, ardifer, acac, acdifer, etac, etacac, etinac, inccap, incrap, incsupr, inccomun,
      persoane1, persoane2, persgu, pers_ar, pers_ac, pers_acx,
      pascens, pcurent_sc, pcurent_li, per_sal_fe, perdifar, perdifac,
      suprafata1, suprafata2, sl_inc, sl_incd, sl_dinc, sl_difin, set_difin, set_comun, sup_ec_ter,
      sl_abon, sl_salte, sl_salfe, sl_presse, sl_chsed, sl_ascen, sl_chadm,
      observatii
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?
    )
  `);

  for (const b of blocuri) {
    insBlocSnap.run(
      period.id, b.id || null, period.an, period.luna, String(b.bloc || ''),
      String(b.strada || ''), String(b.numar || ''), String(b.cod || ''), String(b.cod_postal || ''),
      Number(b.tot_apart ?? b.total_apartamente ?? 0), Number(b.suprafata1 ?? b.suprafata_totala ?? 0),
      String(b.mod_r_dif || 'PER'), String(b.mod_r_inc || 'SL'), String(b.modr_difin || 'SL'), String(b.mod_r_asc || 'PER'),
      Number(b.proc_av_ac ?? 100), Number(b.proc_av_in ?? 100), Number(b.procinccom ?? 0),
      Number(b.proc_sal_f ?? 100), Number(b.proc_sal_t ?? 100), Number(b.proc_abona ?? 100),
      Number(b.proc_chadm ?? 100), Number(b.procgunoi ?? 100), Number(b.proc_chsed ?? 100),
      Number(b.inar ?? 0), Number(b.ivar ?? 0), String(b.cp_ar || 'C'),
      Number(b.inac ?? 0), Number(b.ivac ?? 0), String(b.cp_ac || 'C'),
      Number(b.inin ?? 0), Number(b.ivin ?? 0), Number(b.constin ?? 1), String(b.cp_in || 'P'),
      Number(b.ecart_temp ?? 0), Number(b.rand_tr ?? 100), Number(b.tarif_et ?? 0),
      Number(b.gaz ?? 0), Number(b.gunoi ?? 0), Number(b.curent ?? 0), Number(b.curent_sc ?? 0), Number(b.curent_li ?? 0),
      Number(b.ascensor ?? 0), Number(b.sal_tesa ?? 0), Number(b.sal_feme ?? 0), Number(b.ch_admin ?? 0), Number(b.ch_sediu ?? 0),
      Number(b.cota_fr ?? 0), Number(b.prest_serv ?? 0), Number(b.chelt_inc ?? 0), Number(b.abonament ?? 0), Number(b.can_met ?? 0),
      Number(b.difarar ?? 0), Number(b.difarac ?? 0), Number(b.difcanar ?? 0), Number(b.difcanac ?? 0), Number(b.difetac ?? 0), Number(b.difetin ?? 0),
      Number(b.arac ?? 0), Number(b.ardifer ?? 0), Number(b.acac ?? 0), Number(b.acdifer ?? 0),
      Number(b.etac ?? 0), Number(b.etacac ?? 0), Number(b.etinac ?? 0), Number(b.inccap ?? 0), Number(b.incrap ?? 0), Number(b.incsupr ?? 0), Number(b.inccomun ?? 0),
      Number(b.persoane1 ?? 0), Number(b.persoane2 ?? 0), Number(b.persgu ?? 0), Number(b.pers_ar ?? 0), Number(b.pers_ac ?? 0), Number(b.pers_acx ?? 0),
      Number(b.pascens ?? 0), Number(b.pcurent_sc ?? 0), Number(b.pcurent_li ?? 0), Number(b.per_sal_fe ?? 0), Number(b.perdifar ?? 0), Number(b.perdifac ?? 0),
      Number(b.suprafata1 ?? 0), Number(b.suprafata2 ?? 0), Number(b.sl_inc ?? 0), Number(b.sl_incd ?? 0), Number(b.sl_dinc ?? 0), Number(b.sl_difin ?? 0), Number(b.set_difin ?? 0), Number(b.set_comun ?? 0), Number(b.sup_ec_ter ?? 0),
      Number(b.sl_abon ?? 0), Number(b.sl_salte ?? 0), Number(b.sl_salfe ?? 0), Number(b.sl_presse ?? 0), Number(b.sl_chsed ?? 0), Number(b.sl_ascen ?? 0), Number(b.sl_chadm ?? 0),
      String(b.observatii || '')
    );
  }

  const insAptSnap = d.prepare(`
    INSERT INTO apartamente_luna (
      perioada_id, apartament_id, bloc_id, an, luna, bloc, numar_apart, nume_proprietar,
      persoane, suprafata, sup_ec_ter, supr_redus,
      d1, d2, p1_scaz, p2_scaz, sl1_scaz, sl2_scaz, set_scaz,
      proc_av_ac, proc_av_in, procg, procgunoi, procascens, proc_cu_sc, proc_cu_li,
      proc_sal_f, proc_sal_t, proc_abona, p_saltesa, p_presserv, proc_chadm, proc_difer, proc_difin, proc_chsed,
      iv_ar_bu, in_ar_bu, d_v_ar_bu, ser_ar_bu,
      iv_ar_ba1, in_ar_ba1, d_v_ar_ba1, ser_ar_ba1,
      iv_ar_ba2, in_ar_ba2, d_v_ar_ba2, ser_ar_ba2,
      iv_ac_bu, in_ac_bu, d_v_ac_bu, ser_ac_bu,
      iv_ac_ba1, in_ac_ba1, d_v_ac_ba1, ser_ac_ba1,
      iv_ac_ba2, in_ac_ba2, d_v_ac_ba2, ser_ac_ba2,
      in_incalzire, iv_incalzire, inin, ivin, constin, d_v_in, ser_in, d_v_inin, ser_inin,
      cp_ar, cp_ac, cp_in,
      serie_r1, iv_r1, in_r1, facttr_r1, coefsp_r1,
      serie_r2, iv_r2, in_r2, facttr_r2, coefsp_r2,
      serie_r3, iv_r3, in_r3, facttr_r3, coefsp_r3,
      serie_r4, iv_r4, in_r4, facttr_r4, coefsp_r4,
      serie_r5, iv_r5, in_r5, facttr_r5, coefsp_r5,
      serie_r6, iv_r6, in_r6, facttr_r6, coefsp_r6,
      serie_r7, iv_r7, in_r7, facttr_r7, coefsp_r7,
      tot_unit, gcal_unit, gcal_mp, gcal_calc, gcal_red, gcal_final,
      ch_box, ch_hav, repar_crt, altele, i, fond_repar, fond_reparatii,
      max_fr, max_fond_rulment, calc_fr, plat_fr, rulment,
      apa_rece, arra, arca, can_mnj, can_mnjar, can_mnjac, can_met,
      apa_calda, incalzire, gaz, gunoi, curent, curent_sc, curent_li,
      ascensor, sal_feme, sal_tesa, ch_admin, ch_sediu, prest_serv, abonament, chelt_inc,
      difarar, difarac, difcanar, difcanac, difetac, difetin,
      total_luna, restante, penalizari, total_general, observatii
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  for (const c of apartamente) {
    const totalLuna = round2(c.total_luna ?? 0);
    const restante = round2(c.restante ?? 0);
    const penalizari = round2(c.penalizari ?? 0);
    const totalGeneral = round2(totalLuna + restante + penalizari);

    insAptSnap.run(
      period.id, c.id || null, c.bloc_id || null, period.an, period.luna,
      String(c.bloc || ''), String(c.numar_apart || c.apart || ''), String(c.nume_proprietar || ''),
      Number(c.persoane ?? 0), Number(c.suprafata ?? 0), Number(c.sup_ec_ter ?? 0), Number(c.supr_redus ?? 0),
      c.d1 ?? null, c.d2 ?? null, Number(c.p1_scaz ?? 0), Number(c.p2_scaz ?? 0),
      Number(c.sl1_scaz ?? 0), Number(c.sl2_scaz ?? 0), Number(c.set_scaz ?? 0),
      Number(c.proc_av_ac ?? 100), Number(c.proc_av_in ?? 100), Number(c.procg ?? 100), Number(c.procgunoi ?? 100),
      Number(c.procascens ?? 100), Number(c.proc_cu_sc ?? 100), Number(c.proc_cu_li ?? 100),
      Number(c.proc_sal_f ?? 100), Number(c.proc_sal_t ?? 100), Number(c.proc_abona ?? 100), Number(c.p_saltesa ?? 100),
      Number(c.p_presserv ?? 100), Number(c.proc_chadm ?? 100), Number(c.proc_difer ?? 100), Number(c.proc_difin ?? 100), Number(c.proc_chsed ?? 100),
      Number(c.iv_ar_bu ?? c.ivarbu ?? 0), Number(c.in_ar_bu ?? c.inarbu ?? 0), c.d_v_ar_bu ?? null, c.ser_ar_bu ?? null,
      Number(c.iv_ar_ba1 ?? c.ivarba1 ?? 0), Number(c.in_ar_ba1 ?? c.inarba1 ?? 0), c.d_v_ar_ba1 ?? null, c.ser_ar_ba1 ?? null,
      Number(c.iv_ar_ba2 ?? c.ivarba2 ?? 0), Number(c.in_ar_ba2 ?? c.inarba2 ?? 0), c.d_v_ar_ba2 ?? null, c.ser_ar_ba2 ?? null,
      Number(c.iv_ac_bu ?? c.ivacbu ?? 0), Number(c.in_ac_bu ?? c.inacbu ?? 0), c.d_v_ac_bu ?? null, c.ser_ac_bu ?? null,
      Number(c.iv_ac_ba1 ?? c.ivacba1 ?? 0), Number(c.in_ac_ba1 ?? c.inacba1 ?? 0), c.d_v_ac_ba1 ?? null, c.ser_ac_ba1 ?? null,
      Number(c.iv_ac_ba2 ?? c.ivacba2 ?? 0), Number(c.in_ac_ba2 ?? c.inacba2 ?? 0), c.d_v_ac_ba2 ?? null, c.ser_ac_ba2 ?? null,
      Number(c.in_incalzire ?? c.inin ?? 0), Number(c.iv_incalzire ?? c.ivin ?? 0),
      Number(c.inin ?? 0), Number(c.ivin ?? 0), Number(c.constin ?? 1), c.d_v_in ?? null, c.ser_in ?? null, c.d_v_inin ?? null, c.ser_inin ?? null,
      String(c.cp_ar || 'C'), String(c.cp_ac || 'C'), String(c.cp_in || 'P'),
      c.serie_r1 ?? null, Number(c.iv_r1 ?? 0), Number(c.in_r1 ?? 0), Number(c.facttr_r1 ?? 1), Number(c.coefsp_r1 ?? 1),
      c.serie_r2 ?? null, Number(c.iv_r2 ?? 0), Number(c.in_r2 ?? 0), Number(c.facttr_r2 ?? 1), Number(c.coefsp_r2 ?? 1),
      c.serie_r3 ?? null, Number(c.iv_r3 ?? 0), Number(c.in_r3 ?? 0), Number(c.facttr_r3 ?? 1), Number(c.coefsp_r3 ?? 1),
      c.serie_r4 ?? null, Number(c.iv_r4 ?? 0), Number(c.in_r4 ?? 0), Number(c.facttr_r4 ?? 1), Number(c.coefsp_r4 ?? 1),
      c.serie_r5 ?? null, Number(c.iv_r5 ?? 0), Number(c.in_r5 ?? 0), Number(c.facttr_r5 ?? 1), Number(c.coefsp_r5 ?? 1),
      c.serie_r6 ?? null, Number(c.iv_r6 ?? 0), Number(c.in_r6 ?? 0), Number(c.facttr_r6 ?? 1), Number(c.coefsp_r6 ?? 1),
      c.serie_r7 ?? null, Number(c.iv_r7 ?? 0), Number(c.in_r7 ?? 0), Number(c.facttr_r7 ?? 1), Number(c.coefsp_r7 ?? 1),
      Number(c.tot_unit ?? 0), Number(c.gcal_unit ?? 0), Number(c.gcal_mp ?? 0), Number(c.gcal_calc ?? 0), Number(c.gcal_red ?? 0), Number(c.gcal_final ?? 0),
      Number(c.ch_box ?? 0), Number(c.ch_hav ?? 0), Number(c.repar_crt ?? 0), Number(c.altele ?? 0), Number(c.i ?? 0),
      Number(c.fond_repar ?? c.fond_reparatii ?? 0), Number(c.fond_reparatii ?? c.fond_repar ?? 0),
      Number(c.max_fr ?? c.max_fond_rulment ?? 0), Number(c.max_fond_rulment ?? c.max_fr ?? 0), Number(c.calc_fr ?? 0), Number(c.plat_fr ?? 0), Number(c.rulment ?? 0),
      Number(c.apa_rece ?? 0), Number(c.arra ?? 0), Number(c.arca ?? 0), Number(c.can_mnj ?? 0), Number(c.can_mnjar ?? 0), Number(c.can_mnjac ?? 0), Number(c.can_met ?? 0),
      Number(c.apa_calda ?? 0), Number(c.incalzire ?? 0), Number(c.gaz ?? 0), Number(c.gunoi ?? 0), Number(c.curent ?? 0), Number(c.curent_sc ?? 0), Number(c.curent_li ?? 0),
      Number(c.ascensor ?? 0), Number(c.sal_feme ?? 0), Number(c.sal_tesa ?? 0), Number(c.ch_admin ?? 0), Number(c.ch_sediu ?? 0), Number(c.prest_serv ?? 0), Number(c.abonament ?? 0), Number(c.chelt_inc ?? 0),
      Number(c.difarar ?? 0), Number(c.difarac ?? 0), Number(c.difcanar ?? 0), Number(c.difcanac ?? 0), Number(c.difetac ?? 0), Number(c.difetin ?? 0),
      totalLuna, restante, penalizari, totalGeneral, String(c.observatii || '')
    );
  }

  d.prepare(`
    INSERT INTO asociatie_luna (
      perioada_id, asoc, apa_rece, can_met, apa_calda, etac, incalzire,
      gunoi, ch_admin, sal_tesa, sal_feme, abonament, ch_sediu, rulment,
      tot_apart, persoane1, persoane2, persgu, pers_ar, pers_ac, pers_acx,
      pascens, pcurent_sc, pcurent_li, per_sal_fe,
      suprafata1, suprafata2, sl_inc, sl_abon, sl_salte, sl_salfe, sl_chsed, sl_chadm, sup_ec_ter
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    period.id,
    String(asociatie.nume || 'ORHIDEEA'),
    Number(asociatie.apa_rece ?? 0), Number(asociatie.can_met ?? 0), Number(asociatie.apa_calda ?? 0),
    Number(asociatie.etac ?? 0), Number(asociatie.incalzire ?? 0),
    Number(asociatie.gunoi ?? 0), Number(asociatie.ch_admin ?? 0), Number(asociatie.sal_tesa ?? 0),
    Number(asociatie.sal_feme ?? 0), Number(asociatie.abonament ?? 0), Number(asociatie.ch_sediu ?? 0), Number(asociatie.rulment ?? 0),
    Number(asociatie.tot_apart ?? 0), Number(asociatie.persoane1 ?? 0), Number(asociatie.persoane2 ?? 0), Number(asociatie.persgu ?? 0),
    Number(asociatie.pers_ar ?? 0), Number(asociatie.pers_ac ?? 0), Number(asociatie.pers_acx ?? 0),
    Number(asociatie.pascens ?? 0), Number(asociatie.pcurent_sc ?? 0), Number(asociatie.pcurent_li ?? 0), Number(asociatie.per_sal_fe ?? 0),
    Number(asociatie.suprafata1 ?? 0), Number(asociatie.suprafata2 ?? 0),
    Number(asociatie.sl_inc ?? 0), Number(asociatie.sl_abon ?? 0), Number(asociatie.sl_salte ?? 0),
    Number(asociatie.sl_salfe ?? 0), Number(asociatie.sl_chsed ?? 0), Number(asociatie.sl_chadm ?? 0),
    Number(asociatie.sup_ec_ter ?? 0)
  );
}

/**
 * Publishes the active or specified period (TRE.PRG):
 * 1. Verifies period is DESCHISA and not already published in datorii.
 * 2. Runs calculation engine (or uses current calculated values if skipRecalc=true).
 * 3. Inserts non-zero R, F, A rows into `datorii`.
 * 4. Freezes snapshots into `apartamente_luna`, `blocuri_luna`, `asociatie_luna`.
 * 5. Marks period status as 'PUBLICATA'.
 */
function publishMonth(arg1, arg2) {
  const { d, options } = resolveDbAndOptions(arg1, arg2);
  const data = getPeriodCalculationData(d, options);
  const { period, asociatie } = data;

  if (!period || !period.id) {
    throw new Error('Perioada nu a fost găsită în baza de date.');
  }

  if (period.status === 'PUBLICATA' || period.status === 'INCHISA') {
    throw new Error(`Perioada ${period.luna}/${period.an} este deja în starea ${period.status} (TRE interzis).`);
  }

  // Check if PUBLISH rows already exist for this period
  const blocIds = data.blocuri.map(b => b.id);
  if (blocIds.length > 0) {
    const ph = blocIds.map(() => '?').join(',');
    const existing = d
      .prepare(`
        SELECT COUNT(*) AS cnt FROM datorii
        WHERE an = ? AND luna = ? AND sursa = 'PUBLISH' AND bloc_id IN (${ph})
      `)
      .get(period.an, period.luna, ...blocIds);

    if (existing && existing.cnt > 0) {
      throw new Error(`Perioada ${period.luna}/${period.an} are deja debite publicate în registru.`);
    }
  }

  const calcOutput = options.skipRecalc ? data : calculatePeriod(data, options);
  if (!options.skipRecalc) {
    savePeriodCalculationData(d, calcOutput);
  }

  const lunaText = LUNI_RO[period.luna] || String(period.luna);
  let insertedRows = 0;
  let totalR = 0;
  let totalF = 0;
  let totalA = 0;

  const insDatorie = d.prepare(`
    INSERT INTO datorii (
      apartament_id, bloc_id, an, luna, luna_text, categorie, valoare, sursa, perioada_id, explicatie
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PUBLISH', ?, ?)
  `);

  const tx = d.transaction(() => {
    for (const c of calcOutput.apartamente) {
      if (!c.id) continue;

      const valR = round2(
        c.total_regie !== undefined
          ? c.total_regie
          : Number(c.apa_rece ?? 0) +
            Number(c.can_mnj ?? 0) +
            Number(c.can_met ?? 0) +
            Number(c.apa_calda ?? 0) +
            Number(c.incalzire ?? 0) +
            Number(c.gaz ?? 0) +
            Number(c.gunoi ?? 0) +
            Number(c.curent ?? 0) +
            Number(c.ascensor ?? 0) +
            Number(c.ch_admin ?? 0) +
            Number(c.ch_sediu ?? 0) +
            Number(c.prest_serv ?? 0) +
            Number(c.altele ?? 0) +
            Number(c.i ?? 0) +
            Number(c.repar_crt ?? 0) +
            Number(c.difarar ?? 0) +
            Number(c.difarac ?? 0) +
            Number(c.difcanar ?? 0) +
            Number(c.difcanac ?? 0) +
            Number(c.difetac ?? 0) +
            Number(c.difetin ?? 0) +
            Number(c.ch_box ?? 0) +
            Number(c.ch_hav ?? 0) +
            Number(c.abonament ?? 0) +
            Number(c.chelt_inc ?? 0) +
            Number(c.sal_feme ?? 0) +
            Number(c.sal_tesa ?? 0)
      );
      const valF = round2(c.rulment ?? 0);
      const valA = round2(c.fond_repar ?? c.fond_reparatii ?? 0);

      if (valR !== 0) {
        insDatorie.run(c.id, c.bloc_id, period.an, period.luna, lunaText, 'R', valR, period.id, `Intretinere ${lunaText} ${period.an}`);
        insertedRows++;
        totalR = round2(totalR + valR);
      }
      if (valF !== 0) {
        insDatorie.run(c.id, c.bloc_id, period.an, period.luna, lunaText, 'F', valF, period.id, `Fond rulment ${lunaText} ${period.an}`);
        insertedRows++;
        totalF = round2(totalF + valF);
      }
      if (valA !== 0) {
        insDatorie.run(c.id, c.bloc_id, period.an, period.luna, lunaText, 'A', valA, period.id, `Fond reparatii ${lunaText} ${period.an}`);
        insertedRows++;
        totalA = round2(totalA + valA);
      }

      syncApartmentScalars(d, c.id);
    }

    writePeriodSnapshots(d, period, calcOutput.asociatie, calcOutput.blocuri, calcOutput.apartamente);

    d.prepare("UPDATE perioade SET status = 'PUBLICATA' WHERE id = ?").run(period.id);
  });

  tx();

  return {
    perioada_id: period.id,
    an: period.an,
    luna: period.luna,
    status: 'PUBLICATA',
    inserted_rows: insertedRows,
    totals: {
      R: totalR,
      F: totalF,
      A: totalA,
      total: round2(totalR + totalF + totalA)
    }
  };
}

/**
 * Unpublishes a period (GOL.PRG):
 * Strictly guarded by zero payments recorded against the period's debts.
 */
function unpublishMonth(arg1, arg2) {
  const { d, options } = resolveDbAndOptions(arg1, arg2);
  const data = getPeriodCalculationData(d, options);
  const { period, blocuri } = data;

  if (!period || !period.id) {
    throw new Error('Perioada nu a fost găsită.');
  }

  if (period.status === 'INCHISA') {
    throw new Error(`Perioada ${period.luna}/${period.an} este ÎNCHISĂ. Redeschideți luna înainte de anularea publicării.`);
  }

  const blocIds = blocuri.map(b => b.id);
  if (blocIds.length > 0) {
    const ph = blocIds.map(() => '?').join(',');
    const paymentCheck = d
      .prepare(`
        SELECT COUNT(p.id) AS cnt, COALESCE(SUM(ABS(p.suma)), 0) AS total_plati
        FROM plati p
        JOIN datorii d ON d.id = p.datorie_id
        LEFT JOIN chitante c ON c.id = p.chitanta_id
        WHERE d.an = ? AND d.luna = ? AND d.bloc_id IN (${ph})
          AND COALESCE(c.anulata, 0) = 0
      `)
      .get(period.an, period.luna, ...blocIds);

    if (paymentCheck && paymentCheck.cnt > 0) {
      throw new Error(
        `Anularea publicării (GOL) este blocată: există ${paymentCheck.cnt} plăți/chitanțe încasate (${round2(paymentCheck.total_plati)} RON) pentru perioada ${period.luna}/${period.an}!`
      );
    }
  }

  let deletedRows = 0;

  const tx = d.transaction(() => {
    if (blocIds.length > 0) {
      const ph = blocIds.map(() => '?').join(',');
      const delInfo = d
        .prepare(`
          DELETE FROM datorii
          WHERE an = ? AND luna = ? AND bloc_id IN (${ph}) AND sursa = 'PUBLISH'
        `)
        .run(period.an, period.luna, ...blocIds);
      deletedRows = delInfo.changes;
    }

    d.prepare('DELETE FROM apartamente_luna WHERE perioada_id = ?').run(period.id);
    d.prepare('DELETE FROM blocuri_luna WHERE perioada_id = ?').run(period.id);
    d.prepare('DELETE FROM asociatie_luna WHERE perioada_id = ?').run(period.id);

    d.prepare("UPDATE perioade SET status = 'DESCHISA' WHERE id = ?").run(period.id);

    for (const c of data.apartamente) {
      if (c.id) syncApartmentScalars(d, c.id);
    }
  });

  tx();

  return {
    perioada_id: period.id,
    an: period.an,
    luna: period.luna,
    status: 'DESCHISA',
    deleted_rows: deletedRows
  };
}

/**
 * Closes the active month (SLU.PRG):
 * 1. If period is DESCHISA, publishes it first (books R/F/A & snapshots).
 * 2. Marks period as INCHISA.
 * 3. Rotates meter and allocator indices (IV = IN, IN = 0) across apartments and blocks.
 * 4. Zeroes monthly computed charges & monthly invoices while preserving settings, modes,
 *    percentages, reductions, serials, metrology dates, and recurring charges (CH_BOX, CH_HAV, I, FOND_REPAR).
 * 5. Creates and activates the next working period (DESCHISA).
 */
function closeMonth(arg1, arg2) {
  const { d, options } = resolveDbAndOptions(arg1, arg2);
  let data = getPeriodCalculationData(d, options);
  const { period, asociatie } = data;

  if (!period || !period.id) {
    throw new Error('Perioada de lucru nu a fost găsită.');
  }

  if (period.status === 'INCHISA') {
    throw new Error(`Perioada ${period.luna}/${period.an} este deja ÎNCHISĂ.`);
  }

  // If still DESCHISA, publish first unless explicitly skipped
  let publishResult = null;
  if (period.status === 'DESCHISA') {
    publishResult = publishMonth(d, { ...options, periodId: period.id });
    data = getPeriodCalculationData(d, { ...options, periodId: period.id });
  }

  const nextLuna = period.luna === 12 ? 1 : period.luna + 1;
  const nextAn = period.luna === 12 ? period.an + 1 : period.an;
  const nextUltimaZi = getLastDayOfMonthIso(nextAn, nextLuna);

  const blocIds = data.blocuri.map(b => b.id);
  let nextPeriodId = null;

  const tx = d.transaction(() => {
    // 1. Mark current period as INCHISA
    d.prepare(`
      UPDATE perioade
      SET status = 'INCHISA', inchis_la = CURRENT_TIMESTAMP, inchis_de = ?
      WHERE id = ?
    `).run(options.inchis_de || 'Administrator', period.id);

    // 2. Create or update next period row
    const existingNext = d.prepare('SELECT id FROM perioade WHERE an = ? AND luna = ?').get(nextAn, nextLuna);
    if (existingNext) {
      nextPeriodId = existingNext.id;
      d.prepare("UPDATE perioade SET status = 'DESCHISA', ultima_zi = ? WHERE id = ?").run(nextUltimaZi, nextPeriodId);
    } else {
      const pInfo = d
        .prepare(`
          INSERT INTO perioade (asociatie_id, an, luna, status, ultima_zi, tarif_ar, tarif_ca, proc_ca, tarif_et)
          VALUES (?, ?, ?, 'DESCHISA', ?, ?, ?, ?, ?)
        `)
        .run(
          asociatie.id || 1,
          nextAn,
          nextLuna,
          nextUltimaZi,
          Number(data.general.tarif_ar ?? 9.48),
          Number(data.general.tarif_ca ?? 9.67),
          Number(data.general.proc_ca ?? 100),
          Number(data.general.tarif_et ?? 0)
        );
      nextPeriodId = Number(pInfo.lastInsertRowid);
    }

    // 3. Create or update general row for next period
    const existingGen = d.prepare('SELECT id FROM general WHERE an = ? AND luna = ?').get(nextAn, nextLuna);
    if (!existingGen) {
      d.prepare(`
        INSERT INTO general (perioada_id, an, luna, ultima_zi, tarif_ar, tarif_ca, proc_ca)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextPeriodId,
        nextAn,
        nextLuna,
        nextUltimaZi,
        Number(data.general.tarif_ar ?? 9.48),
        Number(data.general.tarif_ca ?? 9.67),
        Number(data.general.proc_ca ?? 100)
      );
    }

    // 4. Rotate apartment meters & allocators (IV = IN, IN = 0) and zero monthly charges (SLU.PRG lines 67-115)
    if (blocIds.length > 0) {
      const ph = blocIds.map(() => '?').join(',');
      d.prepare(`
        UPDATE apartamente SET
          iv_ar_bu = in_ar_bu, in_ar_bu = 0,
          iv_ar_ba1 = in_ar_ba1, in_ar_ba1 = 0,
          iv_ar_ba2 = in_ar_ba2, in_ar_ba2 = 0,
          iv_ac_bu = in_ac_bu, in_ac_bu = 0,
          iv_ac_ba1 = in_ac_ba1, in_ac_ba1 = 0,
          iv_ac_ba2 = in_ac_ba2, in_ac_ba2 = 0,
          ivin = inin, inin = 0,
          iv_incalzire = in_incalzire, in_incalzire = 0,
          iv_r1 = in_r1, in_r1 = 0,
          iv_r2 = in_r2, in_r2 = 0,
          iv_r3 = in_r3, in_r3 = 0,
          iv_r4 = in_r4, in_r4 = 0,
          iv_r5 = in_r5, in_r5 = 0,
          iv_r6 = in_r6, in_r6 = 0,
          iv_r7 = in_r7, in_r7 = 0,
          apa_rece = 0, arra = 0, arca = 0,
          can_mnj = 0, can_mnjar = 0, can_mnjac = 0, can_met = 0,
          apa_calda = 0, incalzire = 0, gaz = 0, gunoi = 0,
          curent = 0, curent_sc = 0, curent_li = 0,
          ascensor = 0, ch_admin = 0, ch_sediu = 0,
          rulment = 0, prest_serv = 0, altele = 0, repar_crt = 0,
          difarar = 0, difcanar = 0, difarac = 0, difcanac = 0, difetac = 0, difetin = 0,
          calc_fr = 0, abonament = 0, chelt_inc = 0, sal_feme = 0, sal_tesa = 0
        WHERE bloc_id IN (${ph})
      `).run(...blocIds);

      // 5. Rotate block meters (IV = IN, IN = 0) and zero block monthly invoices & differences (SLU.PRG lines 118-137)
      d.prepare(`
        UPDATE blocuri SET
          ivar = inar, inar = 0,
          index_vechi_ar = index_nou_ar, index_nou_ar = 0,
          ivac = inac, inac = 0,
          index_vechi_ac = index_nou_ac, index_nou_ac = 0,
          ivin = inin, inin = 0,
          index_vechi_in = index_nou_in, index_nou_in = 0,
          gaz = 0, gunoi = 0, curent = 0, curent_sc = 0, curent_li = 0,
          ascensor = 0, ch_admin = 0, ecart_temp = 0, ch_sediu = 0, prest_serv = 0,
          can_met = 0, abonament = 0, sal_feme = 0, sal_tesa = 0, chelt_inc = 0,
          difarar = 0, difcanar = 0, difarac = 0, difcanac = 0, difetac = 0, difetin = 0,
          arac = 0, ardifer = 0, acac = 0, acdifer = 0, etac = 0, etacac = 0, etinac = 0,
          inccap = 0, incrap = 0, incsupr = 0, inccomun = 0
        WHERE id IN (${ph})
      `).run(...blocIds);
    }

    // 6. Zero association monthly invoices and advance working month/year (SLU.PRG lines 140-149)
    d.prepare(`
      UPDATE asociatie SET
        apa_rece = 0, can_met = 0, apa_calda = 0, incalzire = 0, gunoi = 0,
        ch_admin = 0, etac = 0, ch_sediu = 0, abonament = 0,
        luna_lucru = ?, an_lucru = ?
      WHERE id = ?
    `).run(nextLuna, nextAn, asociatie.id || 1);

    // 7. Carry over patrimoniu structure with suma = 0 for the new period (SLU.PRG line 154)
    const oldPatrim = d.prepare('SELECT * FROM patrimoniu WHERE perioada_id = ?').all(period.id);
    const insPatrim = d.prepare(`
      INSERT INTO patrimoniu (perioada_id, asoc, document, data, suma, act_pas, explicatie, perioada, data_pres)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
    `);
    for (const pt of oldPatrim) {
      insPatrim.run(nextPeriodId, pt.asoc, pt.document, pt.data, pt.act_pas, pt.explicatie, pt.perioada, pt.data_pres);
    }

    // 8. Record in istoric_luni for legacy UI compatibility
    d.prepare(`
      INSERT INTO istoric_luni (luna, an, data_inchidere, inchis_de, total_calculat, total_incasat, observatii)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(
      period.luna,
      period.an,
      new Date().toISOString().slice(0, 10),
      options.inchis_de || 'Administrator',
      Number(publishResult?.totals?.total || 0),
      `Închidere lună SLU (${period.luna}/${period.an} -> ${nextLuna}/${nextAn})`
    );
  });

  tx();

  return {
    closed_period: { id: period.id, an: period.an, luna: period.luna, status: 'INCHISA' },
    next_period: { id: nextPeriodId, an: nextAn, luna: nextLuna, status: 'DESCHISA', ultima_zi: nextUltimaZi },
    publish_result: publishResult
  };
}

/**
 * Reopens a closed period, restoring apartment and block states from its frozen snapshot,
 * and logs the action in `audit_logs`.
 */
function reopenMonth(arg1, arg2) {
  const { d, options } = resolveDbAndOptions(arg1, arg2);
  const data = getPeriodCalculationData(d, options);
  const { period, asociatie } = data;

  if (!period || !period.id) {
    throw new Error('Perioada de redeschis nu a fost găsită.');
  }

  const aptSnaps = d.prepare('SELECT * FROM apartamente_luna WHERE perioada_id = ?').all(period.id);
  const blocSnaps = d.prepare('SELECT * FROM blocuri_luna WHERE perioada_id = ?').all(period.id);

  const tx = d.transaction(() => {
    // Restore apartments from snapshot if available
    if (aptSnaps.length > 0) {
      const updApt = d.prepare(`
        UPDATE apartamente SET
          iv_ar_bu = ?, in_ar_bu = ?, iv_ar_ba1 = ?, in_ar_ba1 = ?, iv_ar_ba2 = ?, in_ar_ba2 = ?,
          iv_ac_bu = ?, in_ac_bu = ?, iv_ac_ba1 = ?, in_ac_ba1 = ?, iv_ac_ba2 = ?, in_ac_ba2 = ?,
          inin = ?, ivin = ?, in_incalzire = ?, iv_incalzire = ?,
          iv_r1 = ?, in_r1 = ?, iv_r2 = ?, in_r2 = ?, iv_r3 = ?, in_r3 = ?, iv_r4 = ?, in_r4 = ?,
          iv_r5 = ?, in_r5 = ?, iv_r6 = ?, in_r6 = ?, iv_r7 = ?, in_r7 = ?,
          apa_rece = ?, arra = ?, arca = ?, can_mnj = ?, can_mnjar = ?, can_mnjac = ?, can_met = ?,
          apa_calda = ?, incalzire = ?, gaz = ?, gunoi = ?, curent = ?, curent_sc = ?, curent_li = ?,
          ascensor = ?, sal_feme = ?, sal_tesa = ?, ch_admin = ?, ch_sediu = ?, prest_serv = ?,
          abonament = ?, chelt_inc = ?, rulment = ?, calc_fr = ?, plat_fr = ?,
          difarar = ?, difarac = ?, difcanar = ?, difcanac = ?, difetac = ?, difetin = ?
        WHERE id = ?
      `);

      for (const s of aptSnaps) {
        if (!s.apartament_id) continue;
        updApt.run(
          s.iv_ar_bu, s.in_ar_bu, s.iv_ar_ba1, s.in_ar_ba1, s.iv_ar_ba2, s.in_ar_ba2,
          s.iv_ac_bu, s.in_ac_bu, s.iv_ac_ba1, s.in_ac_ba1, s.iv_ac_ba2, s.in_ac_ba2,
          s.inin, s.ivin, s.in_incalzire, s.iv_incalzire,
          s.iv_r1, s.in_r1, s.iv_r2, s.in_r2, s.iv_r3, s.in_r3, s.iv_r4, s.in_r4,
          s.iv_r5, s.in_r5, s.iv_r6, s.in_r6, s.iv_r7, s.in_r7,
          s.apa_rece, s.arra, s.arca, s.can_mnj, s.can_mnjar, s.can_mnjac, s.can_met,
          s.apa_calda, s.incalzire, s.gaz, s.gunoi, s.curent, s.curent_sc, s.curent_li,
          s.ascensor, s.sal_feme, s.sal_tesa, s.ch_admin, s.ch_sediu, s.prest_serv,
          s.abonament, s.chelt_inc, s.rulment, s.calc_fr, s.plat_fr,
          s.difarar, s.difarac, s.difcanar, s.difcanac, s.difetac, s.difetin,
          s.apartament_id
        );
      }
    }

    if (blocSnaps.length > 0) {
      const updBloc = d.prepare(`
        UPDATE blocuri SET
          inar = ?, ivar = ?, index_nou_ar = ?, index_vechi_ar = ?,
          inac = ?, ivac = ?, index_nou_ac = ?, index_vechi_ac = ?,
          inin = ?, ivin = ?, index_nou_in = ?, index_vechi_in = ?,
          ecart_temp = ?, gaz = ?, gunoi = ?, curent = ?, curent_sc = ?, curent_li = ?,
          ascensor = ?, sal_tesa = ?, sal_feme = ?, ch_admin = ?, ch_sediu = ?,
          prest_serv = ?, chelt_inc = ?, abonament = ?, can_met = ?,
          difarar = ?, difarac = ?, difcanar = ?, difcanac = ?, difetac = ?, difetin = ?
        WHERE id = ?
      `);

      for (const b of blocSnaps) {
        if (!b.bloc_id) continue;
        updBloc.run(
          b.inar, b.ivar, b.inar, b.ivar,
          b.inac, b.ivac, b.inac, b.ivac,
          b.inin, b.ivin, b.inin, b.ivin,
          b.ecart_temp, b.gaz, b.gunoi, b.curent, b.curent_sc, b.curent_li,
          b.ascensor, b.sal_tesa, b.sal_feme, b.ch_admin, b.ch_sediu,
          b.prest_serv, b.chelt_inc, b.abonament, b.can_met,
          b.difarar, b.difarac, b.difcanar, b.difcanac, b.difetac, b.difetin,
          b.bloc_id
        );
      }
    }

    d.prepare("UPDATE perioade SET status = 'PUBLICATA', inchis_la = NULL WHERE id = ?").run(period.id);
    d.prepare('UPDATE asociatie SET luna_lucru = ?, an_lucru = ? WHERE id = ?').run(
      period.luna,
      period.an,
      asociatie.id || 1
    );

    d.prepare(`
      INSERT INTO audit_logs (username, actiune, entitate, entitate_id, detalii)
      VALUES (?, 'REOPEN_MONTH', 'perioade', ?, ?)
    `).run(
      options.username || 'Administrator',
      period.id,
      `Redeschidere perioadă ${period.luna}/${period.an}`
    );
  });

  tx();

  return {
    perioada_id: period.id,
    an: period.an,
    luna: period.luna,
    status: 'PUBLICATA',
    restored_apartments: aptSnaps.length,
    restored_blocks: blocSnaps.length
  };
}

module.exports = {
  publishMonth,
  unpublishMonth,
  closeMonth,
  reopenMonth,
  writePeriodSnapshots,
  getLastDayOfMonthIso
};
