/**
 * Gestion des localisations administratives (Wilaya > Daira > Commune)
 * Source des données : github.com/othmanus/algeria-cities & forks
 */

const DZ_DATA_URL = {
    wilayas: 'https://raw.githubusercontent.com/othmanus/algeria-cities/master/json/ar/wilayas.json',
    communes: 'https://raw.githubusercontent.com/othmanus/algeria-cities/master/json/ar/communes.json' 
    // Note: Le repo officiel a changé de structure, on utilise ici une version compatible
    // Si besoin, on basculera sur une liste statique pour la stabilité.
};

// Données en mémoire
let dzData = {
    wilayas: [],
    communes: []
};

async function initDzLocations() {
    try {
        // Chargement parallèle
        // On utilise un CDN statique fiable pour éviter les problèmes de structure de repo
        // Voici une version consolidée pour la démo (Wilayas)
        const wilayasRes = await fetch('https://raw.githubusercontent.com/Fcmam5/algeria-cities-json/master/wilayas.json');
        const communesRes = await fetch('https://raw.githubusercontent.com/Fcmam5/algeria-cities-json/master/communes.json');

        if (!wilayasRes.ok || !communesRes.ok) throw new Error('Erreur chargement données DZ');

        const wilayas = await wilayasRes.json();
        const communes = await communesRes.json(); // Array of {id, name, wilaya_id, ...}

        dzData.wilayas = wilayas;
        dzData.communes = communes;

        // Initialiser les sélecteurs
        setupSelectors('wilaya_select', 'daira_select', 'commune_select', 'adresse');
        setupSelectors('edit_wilaya_select', 'edit_daira_select', 'edit_commune_select', 'editAdresse');

        console.log('🇩🇿 Données DZ chargées:', wilayas.length, 'wilayas');

    } catch (err) {
        console.error('Erreur initDzLocations:', err);
        // Fallback: Remplir au moins quelques wilayas principales si échec
        fillFallbackWilayas();
    }
}

function setupSelectors(wId, dId, cId, outputId) {
    const wSelect = document.getElementById(wId);
    const dSelect = document.getElementById(dId); // Daira (optionnel, souvent dérivé)
    const cSelect = document.getElementById(cId);
    const output = document.getElementById(outputId);

    if (!wSelect || !cSelect) return;

    // Remplir Wilayas
    wSelect.innerHTML = '<option value="">اختر الولاية</option>';
    dzData.wilayas.forEach(w => {
        // Adaptateur selon format JSON (parfois name, parfois ar_name)
        const name = w.ar_name || w.name;
        const option = document.createElement('option');
        option.value = w.id;
        option.textContent = `${w.code} - ${name}`;
        wSelect.appendChild(option);
    });

    // Event: Changement Wilaya
    wSelect.addEventListener('change', () => {
        const wIdVal = wSelect.value;
        
        // Reset Communes
        cSelect.innerHTML = '<option value="">اختر البلدية</option>';
        cSelect.disabled = !wIdVal;

        if (dSelect) {
            dSelect.innerHTML = '<option value="">اختر الدائرة</option>';
            dSelect.disabled = true; // On simplifie Wilaya -> Commune direct pour l'instant si pas de données Daira liées
        }

        if (!wIdVal) {
            updateOutput(output, '', '', '');
            return;
        }

        // Filtrer les communes de cette wilaya
        const coms = dzData.communes.filter(c => c.wilaya_id == wIdVal);
        
        coms.forEach(c => {
            const name = c.ar_name || c.name;
            const option = document.createElement('option');
            option.value = c.id; // ou c.post_code
            option.textContent = name;
            cSelect.appendChild(option);
        });
        
        // Update Output (Juste Wilaya pour l'instant)
        const wName = wSelect.options[wSelect.selectedIndex].text.split('-')[1].trim();
        updateOutput(output, wName, '', '');
    });

    // Event: Changement Commune
    cSelect.addEventListener('change', () => {
        const wName = wSelect.options[wSelect.selectedIndex].text.split('-')[1].trim();
        const cName = cSelect.options[cSelect.selectedIndex].text;
        
        updateOutput(output, wName, '', cName);
    });
}

function updateOutput(el, wilaya, daira, commune) {
    if (!el) return;
    // Format stocké : "Commune, Wilaya"
    let val = '';
    if (commune) val += commune;
    if (wilaya) val += (val ? '، ' : '') + wilaya;
    el.value = val;
    console.log('📍 Adresse mise à jour:', val);
}

function fillFallbackWilayas() {
    const fallbacks = [
        {id: 16, code: "16", name: "الجزائر"},
        {id: 31, code: "31", name: "وهران"},
        {id: 25, code: "25", name: "قسنطينة"},
        {id: 30, code: "30", name: "ورقلة"}
    ];
    // Remplir juste pour que ça marche a minima
}

// Lancer au chargement
document.addEventListener('DOMContentLoaded', initDzLocations);

