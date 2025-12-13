/**
 * Gestion des localisations administratives (Wilaya > Commune)
 * Version autonome (Données intégrées pour éviter les erreurs de chargement)
 */

// Liste officielle des 58 Wilayas d'Algérie
const WILAYAS_LIST = [
    {id: "01", name: "أدرار", code: "01"}, {id: "02", name: "الشلف", code: "02"}, {id: "03", name: "الأغواط", code: "03"}, {id: "04", name: "أم البواقي", code: "04"}, 
    {id: "05", name: "باتنة", code: "05"}, {id: "06", name: "بجاية", code: "06"}, {id: "07", name: "بسكرة", code: "07"}, {id: "08", name: "بشار", code: "08"}, 
    {id: "09", name: "البليدة", code: "09"}, {id: "10", name: "البويرة", code: "10"}, {id: "11", name: "تمنراست", code: "11"}, {id: "12", name: "تبسة", code: "12"}, 
    {id: "13", name: "تلمسان", code: "13"}, {id: "14", name: "تيارت", code: "14"}, {id: "15", name: "تيزي وزو", code: "15"}, {id: "16", name: "الجزائر", code: "16"}, 
    {id: "17", name: "الجلفة", code: "17"}, {id: "18", name: "جيجل", code: "18"}, {id: "19", name: "سطيف", code: "19"}, {id: "20", name: "سعيدة", code: "20"}, 
    {id: "21", name: "سكيكدة", code: "21"}, {id: "22", name: "سيدي بلعباس", code: "22"}, {id: "23", name: "عنابة", code: "23"}, {id: "24", name: "قالمة", code: "24"}, 
    {id: "25", name: "قسنطينة", code: "25"}, {id: "26", name: "المدية", code: "26"}, {id: "27", name: "مستغانم", code: "27"}, {id: "28", name: "المسيلة", code: "28"}, 
    {id: "29", name: "معسكر", code: "29"}, {id: "30", name: "ورقلة", code: "30"}, {id: "31", name: "وهران", code: "31"}, {id: "32", name: "البيض", code: "32"}, 
    {id: "33", name: "إليزي", code: "33"}, {id: "34", name: "برج بوعريريج", code: "34"}, {id: "35", name: "بومرداس", code: "35"}, {id: "36", name: "الطرف", code: "36"}, 
    {id: "37", name: "تندوف", code: "37"}, {id: "38", name: "تيسمسيلت", code: "38"}, {id: "39", name: "الوادي", code: "39"}, {id: "40", name: "خنشلة", code: "40"}, 
    {id: "41", name: "سوق أهراس", code: "41"}, {id: "42", name: "تيبازة", code: "42"}, {id: "43", name: "ميلة", code: "43"}, {id: "44", name: "عين الدفلى", code: "44"}, 
    {id: "45", name: "النعامة", code: "45"}, {id: "46", name: "عين تموشنت", code: "46"}, {id: "47", name: "غرداية", code: "47"}, {id: "48", name: "غليزان", code: "48"},
    {id: "49", name: "تيميمون", code: "49"}, {id: "50", name: "برج باجي مختار", code: "50"}, {id: "51", name: "أولاد جلال", code: "51"}, {id: "52", name: "بني عباس", code: "52"},
    {id: "53", name: "عين صالح", code: "53"}, {id: "54", name: "عين قزام", code: "54"}, {id: "55", name: "تقرت", code: "55"}, {id: "56", name: "جانث", code: "56"},
    {id: "57", name: "المغير", code: "57"}, {id: "58", name: "المنيعة", code: "58"}
];

// URL de secours pour les communes (si fetch possible)
const COMMUNES_URL = 'https://raw.githubusercontent.com/Fcmam5/algeria-cities-json/master/communes.json';

// Données en mémoire
let dzData = {
    wilayas: WILAYAS_LIST,
    communes: []
};

async function initDzLocations() {
    // 1. Charger les Wilayas (Statique = Instantané)
    populateWilayas('wilaya_select');
    populateWilayas('edit_wilaya_select');

    // 2. Tenter de charger les communes en arrière-plan
    try {
        const res = await fetch(COMMUNES_URL);
        if (res.ok) {
            dzData.communes = await res.json();
            console.log('✅ Communes chargées:', dzData.communes.length);
        } else {
            console.warn('⚠️ Impossible de charger les communes (Offline?)');
        }
    } catch (e) {
        console.warn('⚠️ Mode hors-ligne : Communes non disponibles', e);
    }

    // 3. Activer les écouteurs d'événements
    setupListeners('wilaya_select', 'daira_select', 'commune_select', 'adresse');
    setupListeners('edit_wilaya_select', 'edit_daira_select', 'edit_commune_select', 'editAdresse');
}

function populateWilayas(selectId) {
    const el = document.getElementById(selectId);
    if (!el) return;
    el.innerHTML = '<option value="">اختر الولاية</option>';
    dzData.wilayas.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.code} - ${w.name}`;
        el.appendChild(opt);
    });
}

function setupListeners(wId, dId, cId, outputId) {
    const wSelect = document.getElementById(wId);
    const dSelect = document.getElementById(dId);
    const cSelect = document.getElementById(cId);
    const output = document.getElementById(outputId);

    if (!wSelect) return;

    wSelect.addEventListener('change', () => {
        const wIdVal = wSelect.value;
        const wName = wSelect.options[wSelect.selectedIndex].text.split('-')[1]?.trim() || '';

        // Reset Communes
        if (cSelect) {
            cSelect.innerHTML = '<option value="">اختر البلدية</option>';
            cSelect.disabled = true;
            
            if (wIdVal && dzData.communes.length > 0) {
                // Filtrer (wilaya_id dans le JSON est souvent numérique, wIdVal est string "01")
                // On compare en string pour être sûr
                const coms = dzData.communes.filter(c => parseInt(c.wilaya_id) === parseInt(wIdVal));
                
                if (coms.length > 0) {
                    cSelect.disabled = false;
                    coms.sort((a,b) => (a.ar_name || a.name).localeCompare(b.ar_name || b.name));
                    coms.forEach(c => {
                        const opt = document.createElement('option');
                        opt.value = c.ar_name || c.name;
                        opt.textContent = c.ar_name || c.name;
                        cSelect.appendChild(opt);
                    });
                } else {
                    const opt = document.createElement('option');
                    opt.textContent = "جاري تحميل البلديات...";
                    cSelect.appendChild(opt);
                }
            }
        }

        // Désactiver Daira pour l'instant (simplification UX)
        if (dSelect) {
            dSelect.innerHTML = '<option value="">اختر الدائرة</option>';
            dSelect.disabled = true; 
        }

        updateOutput(output, wName, '', '');
    });

    if (cSelect) {
        cSelect.addEventListener('change', () => {
            const wName = wSelect.options[wSelect.selectedIndex].text.split('-')[1]?.trim() || '';
            const cName = cSelect.value;
            updateOutput(output, wName, '', cName);
        });
    }
}

function updateOutput(el, wilaya, daira, commune) {
    if (!el) return;
    let val = '';
    if (commune) val += commune;
    if (wilaya) val += (val ? '، ' : '') + wilaya;
    el.value = val;
    console.log('📍 Adresse sélectionnée:', val);
}

document.addEventListener('DOMContentLoaded', initDzLocations);
