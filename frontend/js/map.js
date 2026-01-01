/* --------------------------------- */
/* Configuration Globale & Helpers   */
/* --------------------------------- */
const STORAGE_KEY = 'algerie_verte_v3';
// 🔹 URL de l'API déployée sur Render
const API_URL = 'https://greenalgeria-backend.onrender.com/api/contributions';
const UPLOAD_URL = 'https://greenalgeria-backend.onrender.com/api/upload';

let map, markerCluster, heatLayer;
let entries = [];
let tileDefault, tileToner;
// Variables globales pour les graphiques
let typesChartInstance = null;
let geojsonBounds = null;
let tempMarker = null;
// Map selection mode removed
let currentFormLat = null;
let currentFormLng = null;
let currentEditLat = null;
let currentEditLng = null;
let watchPositionId = null; // ID pour watchPosition (géolocalisation mobile)
const ALGERIA_CENTER = [28.0339, 1.6596];
const APPROX_BOUNDS = L.latLngBounds([18.9681, -8.6675], [37.0937, 11.9795]);
let searchTimeout;

/* Helper: Debounce pour la recherche (UX) */
function debounce(func, delay) {
  return function () {
    const context = this;
    const args = arguments;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => func.apply(context, args), delay);
  };
}
const debouncedSearch = debounce(applyFiltersAndSort, 300);

/* Fonction utilitaire pour haptic feedback */
function hapticFeedback(type = 'light') {
  if (!navigator.vibrate) return;

  const patterns = {
    light: 10,
    medium: [10, 20, 10],
    heavy: [20, 30, 20, 30, 20],
    success: [10, 50, 10],
    error: [20, 50, 20, 50, 20]
  };

  navigator.vibrate(patterns[type] || patterns.light);
}

/* Helper: toast avancé */
function toast(msg, type = 'success', timeout = 4000) {
  const t = document.getElementById('toast');
  if (!t) {
    console.warn('Toast element missing:', msg);
    return;
  }
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.setAttribute('role', 'alert');
  t.style.opacity = '1';
  t.style.display = 'flex';

  // Haptic feedback selon le type
  if (type === 'success') {
    hapticFeedback('success');
  } else if (type === 'error') {
    hapticFeedback('error');
  } else {
    hapticFeedback('light');
  }

  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.style.display = 'none', 300);
  }, timeout);
}

/* Helper escape */
function escapeHtml(s) { if (!s) return ''; return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* Récupère l'icône Font Awesome basée sur le type */
function getTreeIconClass(type) {
  if (!type) return 'fas fa-tree'; // Fallback icon
  type = type.toLowerCase();
  if (type.includes('صنوبر') || type.includes('أرز') || type.includes('conifer')) return 'fas fa-tree';
  if (type.includes('نخيل') || type.includes('palm')) return 'fas fa-leaf';
  if (type.includes('زيتون') || type.includes('olivier')) return 'fas fa-seedling';
  if (type.includes('بلوط') || type.includes('chêne')) return 'fas fa-tree';
  return 'fas fa-seedling';
}

/* Formate la date */
function formatDate(timestamp) {
  if (!timestamp) return 'غير محدد';
  const date = new Date(timestamp);
  const options = { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleDateString('ar-EG', options);
}

/* --------------------------------- */
/* Gestion de la Carte               */
/* --------------------------------- */

function initMap() {
  map = L.map('map', { center: ALGERIA_CENTER, zoom: 5, minZoom: 5, maxZoom: 12, zoomControl: true });

  tileDefault = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  tileToner = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png', { maxZoom: 20, attribution: 'Tiles: Stamen' });

  markerCluster = L.markerClusterGroup({ chunkedLoading: true });
  map.addLayer(markerCluster);

  heatLayer = L.heatLayer([], { radius: 25, blur: 18, maxZoom: 11 });

  // Gérer les clics sur la carte pour définir la position (mode sélection)
  // Click handling removed as per requirement

  // Mobile UX: tap/click sur la carte = fermer la sidebar rapidement
  // (ne gêne pas le drag, Leaflet ne déclenche pas "click" après un pan)
  map.on('click', function () {
    const isMobile = window.matchMedia('(max-width: 1024px)').matches;
    const sidebar = document.getElementById('sidebar');
    if (isMobile && sidebar && sidebar.classList.contains('visible')) {
      toggleSidebar(false);
    }
  });

  // Chargement de la frontière GeoJSON de l'Algérie pour les limites
  fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/DZA.geo.json').then(r => {
    if (!r.ok) throw new Error('GeoJSON load failed');
    return r.json();
  }).then(data => {
    const algeria = L.geoJSON(data, { style: { color: '#1e88e5', weight: 2, fillColor: 'rgba(30, 136, 229,0.06)', fillOpacity: 1 } }).addTo(map);
    geojsonBounds = algeria.getBounds();
    map.fitBounds(geojsonBounds.pad(0.02));
    map.setMaxBounds(geojsonBounds.pad(0.03));
  }).catch(err => {
    console.warn('GeoJSON failed, using approximate bounds', err);
    map.fitBounds(APPROX_BOUNDS);
    map.setMaxBounds(APPROX_BOUNDS);
  });

  document.getElementById('treeForm').addEventListener('input', validateForm);
  document.getElementById('editForm').addEventListener('submit', handleEditSubmit);
  document.getElementById('editForm').addEventListener('input', validateEditForm);

  // Attacher le bouton de géolocalisation (sera aussi fait dans DOMContentLoaded pour sécurité)
  attachGeolocationButton();

  // 🔹 SERVEUR = SOURCE UNIQUE DE VÉRITÉ
  // On charge d'abord depuis le serveur, localStorage n'est qu'un cache de secours
  loadRemoteData();
  validateForm();
}

/**
 * 🔹 Charge les données depuis le serveur MongoDB (SOURCE UNIQUE DE VÉRITÉ)
 * Le serveur est la source principale, localStorage n'est qu'un cache de secours
 */
async function loadRemoteData() {
  console.log('🔄 Chargement des données depuis le serveur...');
  
  // Afficher un indicateur de chargement
  const listContainer = document.getElementById('locationsList');
  if (listContainer) {
    listContainer.innerHTML = '<div class="loading-indicator" style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> جاري التحميل...</div>';
  }
  
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const serverEntries = await response.json();
    if (Array.isArray(serverEntries)) {
      console.log(`✅ ${serverEntries.length} مساهمات تم جلبها من الخادم.`);

      // 🔹 Le serveur remplace TOTALEMENT les données locales
      entries = serverEntries.map(se => {
        // Le backend utilise _id, on le mappe en id si besoin
        if (se._id && !se.id) se.id = se._id;
        return se;
      });

      // Mettre à jour la carte et la liste
      markerCluster.clearLayers();
      entries.forEach(e => addEntryToMap(e));
      applyFiltersAndSort();
      
      // Mettre en cache localement (pour mode hors-ligne)
      saveToLocalCache();

      console.log('✅ Données synchronisées depuis le serveur');
    }
  } catch (error) {
    console.warn('⚠️ تعذر جلب البيانات من الخادم:', error);
    
    // Fallback: charger depuis le cache local si disponible
    const cached = loadFromLocalCache();
    if (cached && cached.length > 0) {
      console.log('📦 Utilisation du cache local (mode hors-ligne)');
      entries = cached;
      markerCluster.clearLayers();
      entries.forEach(e => addEntryToMap(e));
      applyFiltersAndSort();
      toast('تعذر الاتصال بالخادم. يتم عرض البيانات المحفوظة محلياً.', 'alert');
    } else {
      entries = [];
      applyFiltersAndSort();
      toast('تعذر تحميل البيانات. تحقق من اتصال الإنترنت.', 'error');
    }
  }
}

/**
 * Rafraîchit les données depuis le serveur (après ajout/modification/suppression)
 */
async function refreshFromServer() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const serverEntries = await response.json();
    if (Array.isArray(serverEntries)) {
      entries = serverEntries.map(se => {
        if (se._id && !se.id) se.id = se._id;
        return se;
      });

      markerCluster.clearLayers();
      entries.forEach(e => addEntryToMap(e));
      applyFiltersAndSort();
      saveToLocalCache();
      
      // 🔹 Forcer la mise à jour des graphiques après rafraîchissement
      console.log('📊 Mise à jour des graphiques avec', entries.length, 'entrées');
      updateCharts(entries);
    }
  } catch (error) {
    console.error('❌ Erreur lors du rafraîchissement:', error);
  }
}

/**
 * Gère le marqueur temporaire (pour Ajout et Édition)
 * @param {L.LatLng} latlng - Coordonnées de la position
 * @param {boolean} draggable - Si le marqueur peut être déplacé
 * @param {number} zoomLevel - Niveau de zoom optionnel (si non fourni, conserve le zoom actuel ou utilise 10 minimum)
 */
function setTempMarker(latlng, draggable, zoomLevel = null) {
  if (tempMarker) map.removeLayer(tempMarker);

  const tempIcon = L.divIcon({
    className: 'temp-marker-icon',
    html: '<i class="fas fa-map-pin"></i>',
    iconSize: [40, 42],
    iconAnchor: [20, 40]
  });

  // Force draggable = false pour empêcher la modification manuelle de la position GPS
  tempMarker = L.marker(latlng, { icon: tempIcon, draggable: false });

  // Événement dragend supprimé car le marqueur n'est plus déplaçable
  /* tempMarker.on('dragend', function(e) { ... }); */

  tempMarker.addTo(map);

  // Centrer la carte avec animation fluide
  // Si zoomLevel est fourni, l'utiliser, sinon garder le zoom actuel (minimum 10)
  if (zoomLevel !== null) {
    map.setView(latlng, zoomLevel, { animate: true, duration: 0.5 });
  } else {
    const currentZoom = map.getZoom();
    const minZoom = currentZoom < 10 ? 10 : currentZoom;
    map.setView(latlng, minZoom, { animate: true, duration: 0.5 });
  }

  // Animation du marqueur pour attirer l'attention
  setTimeout(() => {
    if (tempMarker && tempMarker._icon) {
      tempMarker._icon.style.transition = 'transform 0.3s ease';
      tempMarker._icon.style.transform = 'scale(1.2)';
      setTimeout(() => {
        if (tempMarker && tempMarker._icon) {
          tempMarker._icon.style.transform = 'scale(1)';
        }
      }, 300);
    }
  }, 100);
}

/**
 * Ajout du marqueur d'arbre sur la carte (avec Popup élégante)
 */
function addEntryToMap(entry) {

  const treeIconClass = getTreeIconClass(entry.type);

  const customIcon = L.divIcon({
    className: 'tree-marker-icon',
    html: `<i class="${treeIconClass}"></i>`,
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -36]
  });

  const marker = L.marker([entry.lat, entry.lng], { icon: customIcon });

  // --- CONTENU DE LA POPUP ÉLÉGANTE ---
  const popupContent = `
    <div class="elegant-popup" dir="rtl">
        <h4><i class="${treeIconClass}" style="margin-left:5px; color:var(--color-secondary);"></i> ${escapeHtml(entry.type)}</h4>
        <p>العدد: ${entry.quantite} شجرة</p>
        <button class="popup-btn" onclick="centerAndOpenPanel('${entry.id}')">
            عرض التفاصيل <i class="fas fa-arrow-left" style="margin-right:5px;"></i>
        </button>
    </div>
  `;
  // ---------------------------------------------

  marker.bindPopup(popupContent, {
    closeButton: false,
    autoClose: true,
    closeOnClick: true,
    // La taille maximale est ajustée par le CSS min-width: 200px
  });

  // Le clic sur le marqueur Ouvre la popup par défaut. 
  // Sur mobile, on ferme la sidebar pour ne pas masquer la popup.
  marker.on('click', function () {
    const isMobile = window.matchMedia('(max-width: 1024px)').matches;
    if (isMobile) { toggleSidebar(false); }
  });

  marker._entryId = entry.id;
  markerCluster.addLayer(marker);

  return marker;
}

/**
 * Centre la carte sur des coordonnées et ajuste le zoom
 */
function centerOn(lat, lng, zoomLevel = 12) {
  map.setView([lat, lng], zoomLevel);
}

/**
 * Fonction combinée pour centrer et ouvrir le panneau de détail
 * Utilisé par le bouton dans la popup et les actions de la liste.
 */
function centerAndOpenPanel(id) {
  const entry = entries.find(x => x.id === id);
  if (!entry) return;

  centerOn(entry.lat, entry.lng, 15);
  showDetailPanel(id);
}

/**
 * Trouve l'entrée et l'affiche dans le panneau de détail
 */
function showDetailPanel(id) {
  const entry = entries.find(x => x.id === id);
  if (!entry) { toast('خطأ: لم يتم العثور على المساهمة', 'error'); return; }

  const typeIcon = getTreeIconClass(entry.type);

  // Mise à jour des boutons d'action
  document.getElementById('detailEditBtn').dataset.id = entry.id;
  document.getElementById('detailDeleteBtn').dataset.id = entry.id;

  // Mise à jour du contenu
  document.getElementById('detail-title').innerHTML = `<i class="${typeIcon}" style="margin-left:5px; color:var(--color-secondary);"></i> ${escapeHtml(entry.type)}`;

  // Correction URL image avec nettoyage et placeholder
  let photoUrl = entry.photo;
  if (photoUrl) {
    // Cas image locale mal formée (gumlet + localhost)
    if (photoUrl.includes('gumlet.io') || (photoUrl.includes('localhost') && window.location.hostname !== 'localhost')) {
      const filename = photoUrl.split('/').pop();
      if (filename && !filename.includes('http')) {
        photoUrl = `${API_URL.replace('/api/contributions', '')}/uploads/${filename}`;
      } else {
        photoUrl = null;
      }
    }
  }

  document.getElementById('detail-photo').src = photoUrl ? photoUrl + '?w=800' : 'https://via.placeholder.com/400x200?text=No+Image';
  document.getElementById('detail-photo').onerror = function () { this.src = 'https://via.placeholder.com/400x200?text=No+Image'; };

  document.getElementById('detail-type').textContent = `${escapeHtml(entry.type)} ${entry.updatedAt ? '(معدّل)' : ''}`;
  document.getElementById('detail-quantite').textContent = `${entry.quantite} شجرة`;
  document.getElementById('detail-nom').textContent = escapeHtml(entry.nom);
  document.getElementById('detail-adresse').textContent = escapeHtml(entry.adresse || 'غير محدد');
  document.getElementById('detail-city').textContent = escapeHtml(entry.city || 'غير محدد');
  document.getElementById('detail-district').textContent = escapeHtml(entry.district || 'غير محدد');
  document.getElementById('detail-date').textContent = entry.date ? entry.date.replace(/-/g, '/') : 'غير محدد';
  document.getElementById('detail-createdAt').textContent = formatDate(entry.createdAt);
  // Coords display removed

  // Pour l'action "Télécopie"
  document.getElementById('detail-lat').value = entry.lat;
  document.getElementById('detail-lng').value = entry.lng;

  // Afficher le panneau de détail (et changer l'onglet sur mobile)
  switchPanel('detail-panel');
  toggleSidebar(true, 'detail-panel'); // Ouvre la barre latérale sur le détail si mobile

  // Fermer toutes les popups
  map.closePopup();

  // Assurer que le marqueur est visible et ouvrir sa *quickPopup* (optionnel)
  let found = null;
  markerCluster.eachLayer(l => { if (l._entryId === id) found = l; });
  if (found) found.openPopup();
}

/**
 * Fonction combinée pour centrer et ouvrir la popup (utilisée par la liste)
 */
function centerAndOpenPopup(id) {
  const entry = entries.find(x => x.id === id);
  if (!entry) return;

  // 1. Centrer la carte
  centerOn(entry.lat, entry.lng, 15);

  // 2. Trouver le marqueur et ouvrir sa popup
  let markerToOpen = null;
  markerCluster.eachLayer(l => {
    if (l._entryId === id) {
      markerToOpen = l;
    }
  });

  if (markerToOpen) {
    markerToOpen.openPopup();
  }

  // Sur mobile, on ouvre la liste juste pour le contexte
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;
  if (isMobile) { toggleSidebar(true, 'list-panel'); }
}


/* --------------------------------- */
/* Gestion des Données (CRUD)        */
/* --------------------------------- */

/**
 * Convertit un fichier image en base64 pour sauvegarde locale (localStorage)
 */
function convertImageToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    // Limiter la taille à 2MB pour éviter les problèmes de localStorage
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      showFormMessage('حجم الصورة كبير جداً. الحد الأقصى 2MB', 'error');
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      resolve(e.target.result); // Retourne le base64
    };
    reader.onerror = function (error) {
      console.error('Erreur de lecture de l\'image:', error);
      reject(error);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Upload une image vers le serveur et retourne l'URL
 * Stocke le fichier sur le serveur au lieu de base64 dans MongoDB
 */
async function uploadImageToServer(file) {
  if (!file) return null;

  // Limiter la taille à 5MB pour l'upload serveur
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    showFormMessage('حجم الصورة كبير جداً. الحد الأقصى 5MB', 'error');
    return null;
  }

  const formData = new FormData();
  formData.append('image', file);

  try {
    const response = await fetch('https://greenalgeria-backend.onrender.com/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Erreur upload: ${response.status}`);
    }

    const result = await response.json();

    // L'URL retournée est maintenant soit Cloudinary (permanent), soit locale (fallback)
    // On ne passe plus par Gumlet car Cloudinary gère déjà l'optimisation
    const finalUrl = result.url;

    console.log('✅ Image uploadée:', finalUrl);
    return finalUrl;
  } catch (error) {
    console.error('❌ Erreur upload image:', error);
    showFormMessage('خطأ في رفع الصورة إلى الخادم', 'error');
    return null;
  }
}

/**
 * Gestion de l'ajout (Création)
 */
// handleSubmit() est définie plus bas dans le fichier avec l'envoi au serveur

/**
 * 🔹 Gestion de la modification (Update) - ENVOIE AU SERVEUR
 */
async function handleEditSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  let entry = entries.find(x => x.id === id);

  if (!entry) { toast('خطأ: لم يتم العثور على المساهمة', 'error'); return; }

  const newLat = currentEditLat !== null ? currentEditLat : entry.lat;
  const newLng = currentEditLng !== null ? currentEditLng : entry.lng;
  const newQuantite = parseInt(document.getElementById('editQuantite').value);

  // Préparer les données de mise à jour
  const updateData = {
    nom: document.getElementById('editNom').value.trim(),
    adresse: document.getElementById('editAdresse').value.trim(),
    type: document.getElementById('editTypeArbre').value,
    quantite: newQuantite,
    date: document.getElementById('editDatePlanted').value || null,
    lat: newLat,
    lng: newLng
  };

  // Gérer la photo si un nouveau fichier est sélectionné
  const editPhotoInput = document.getElementById('editPhoto');
  if (editPhotoInput && editPhotoInput.files && editPhotoInput.files[0]) {
    try {
      showFormMessage('جاري رفع الصورة...', 'alert');
      const photoUrl = await uploadImageToServer(editPhotoInput.files[0]);
      if (photoUrl) {
        updateData.photo = photoUrl;
      }
    } catch (error) {
      console.error('Erreur lors de l\'upload de la photo:', error);
    }
  }

  // 🔹 Envoyer la mise à jour au SERVEUR
  try {
    toast('جاري التحديث...', 'alert');
    
    // Utiliser l'ID MongoDB (_id) ou l'ID personnalisé
    const serverId = entry._id || entry.id;
    
    const response = await fetch(`${API_URL}/${serverId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });

    const result = await response.json();
    
    if (response.ok && result.success) {
      console.log('✅ Contribution mise à jour sur le serveur');
      
      // Rafraîchir depuis le serveur pour avoir les données à jour
      await refreshFromServer();
      
      closeModal();
      
      // Chercher l'entrée mise à jour
      const updatedEntry = entries.find(x => x.id === id || x._id === serverId);
      if (updatedEntry) {
        centerOn(updatedEntry.lat, updatedEntry.lng);
        showDetailPanel(updatedEntry.id || updatedEntry._id);
      }
      
      toast('✅ تم تحديث المساهمة بنجاح.', 'success');
    } else {
      throw new Error(result.error || 'Erreur serveur');
    }
  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour:', error);
    toast('خطأ في تحديث المساهمة. حاول مرة أخرى.', 'error');
  }
}


/**
 * 🔹 Gestion de la suppression (Delete) - ENVOIE AU SERVEUR
 */
async function removeEntry(id) {
  if (!confirm('هل تريد حذف هذه الإضافة بشكل نهائي؟')) return;
  
  // Trouver l'entrée pour obtenir l'ID serveur
  const entry = entries.find(e => e.id === id);
  if (!entry) {
    toast('خطأ: لم يتم العثور على المساهمة', 'error');
    return;
  }
  
  // Utiliser l'ID MongoDB (_id) ou l'ID personnalisé
  const serverId = entry._id || entry.id;
  
  try {
    toast('جاري الحذف...', 'alert');
    
    const response = await fetch(`${API_URL}/${serverId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();
    
    if (response.ok && result.success) {
      console.log('✅ Contribution supprimée du serveur');
      
      // Supprimer localement aussi pour mise à jour immédiate de l'UI
      entries = entries.filter(e => e.id !== id && e._id !== serverId);
      
      let toRemove = null;
      markerCluster.eachLayer(l => { if (l._entryId === id) toRemove = l; });
      if (toRemove) markerCluster.removeLayer(toRemove);
      
      applyFiltersAndSort();
      saveToLocalCache(); // Mettre à jour le cache
      
      toast('تم حذف المساهمة بنجاح.', 'success');
      
      // Revenir à la liste après suppression
      switchPanel('list-panel');
    } else {
      throw new Error(result.error || 'Erreur serveur');
    }
  } catch (error) {
    console.error('❌ Erreur lors de la suppression:', error);
    toast('خطأ في حذف المساهمة. حاول مرة أخرى.', 'error');
  }
}



/* --------------------------------- */
/* Modal d'édition et Formulaires    */
/* --------------------------------- */
function openEditModal(id) {
  const entry = entries.find(x => x.id === id);
  if (!entry) { toast('خطأ: لم يتم العثور على العنصر', 'error'); return; }

  // Remplissage de la modale
  document.getElementById('editId').value = entry.id;
  document.getElementById('editNom').value = entry.nom;
  document.getElementById('editAdresse').value = entry.adresse || '';
  document.getElementById('editTypeArbre').value = entry.type || '';
  document.getElementById('editDatePlanted').value = entry.date || '';
  // Store current coords in variables for editing purpose (though editing location is restricted)
  currentEditLat = entry.lat;
  currentEditLng = entry.lng;
  document.getElementById('editQuantite').value = entry.quantite || 1;

  // Afficher la photo actuelle si elle existe
  const editPhotoPreview = document.getElementById('editPhotoPreview');
  const editPhotoPreviewImg = document.getElementById('editPhotoPreviewImg');
  if (entry.photo) {
    editPhotoPreviewImg.src = entry.photo + '?w=600';
    editPhotoPreview.style.display = 'block';
  } else {
    editPhotoPreview.style.display = 'none';
  }

  // Réinitialiser le champ de fichier
  document.getElementById('editPhoto').value = '';

  // Initialiser le marqueur temporaire sur la carte
  setTempMarker(L.latLng(entry.lat, entry.lng), true);

  // Afficher la modale
  document.getElementById('editModalOverlay').classList.add('open');
  validateEditForm();
  // Help toast removed
}

function closeModal() {
  document.getElementById('editModalOverlay').classList.remove('open');
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
}
// ... (validateForm, validateEditForm, showFormMessage, resetForm, handleGeolocation restent inchangées)

function validateForm() {
  const nom = document.getElementById('nom').value.trim();
  const type = document.getElementById('type_arbre').value;
  const quantite = parseInt(document.getElementById('quantite').value);
  const isQuantiteValid = !isNaN(quantite) && quantite >= 1;
  // Validate using internal variables
  const isValid = nom && type && isQuantiteValid && currentFormLat !== null && currentFormLng !== null;
  document.querySelector('#treeForm button[type="submit"]').disabled = !isValid;
}

function validateEditForm() {
  const nom = document.getElementById('editNom').value.trim();
  const type = document.getElementById('editTypeArbre').value;
  const quantite = parseInt(document.getElementById('editQuantite').value);
  const isQuantiteValid = !isNaN(quantite) && quantite >= 1;
  // Validate using internal variables (or existing entry values if not changed)
  const isValid = nom && type && isQuantiteValid && currentEditLat !== null && currentEditLng !== null;
  document.getElementById('saveEditBtn').disabled = !isValid;
}

function showFormMessage(text, type = 'success') {
  const el = document.getElementById('formMessage');
  if (!el) return;

  // Réinitialiser les classes
  el.className = '';
  el.classList.add(type);

  // Icône selon le type
  const icon = type === 'success' ? '<i class="fas fa-check-circle"></i>' :
    type === 'error' ? '<i class="fas fa-exclamation-circle"></i>' :
      '<i class="fas fa-info-circle"></i>';

  el.innerHTML = icon + ' <span>' + text + '</span>';
  el.style.display = 'flex';
  el.style.opacity = '1';

  // Scroll vers le message si nécessaire
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);

  // Masquer après 5 secondes avec fade out
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = '';
      el.style.display = 'none';
      el.className = '';
    }, 300);
  }, 5000);
}

function resetForm() {
  document.getElementById('treeForm').reset();
  document.getElementById('preview').style.display = 'none';
  document.getElementById('preview').src = '';
  currentFormLat = null;
  currentFormLng = null;
  document.getElementById('photo').value = '';
  document.getElementById('quantite').value = '1';
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  // Arrêter la géolocalisation en cours si active
  if (watchPositionId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
  validateForm();
}

/**
 * Active/désactive le mode "sélection sur la carte"
 */
// toggleMapSelectionMode removed entirely

/**
 * Attache les event listeners au bouton de géolocalisation
 * Cette fonction peut être appelée plusieurs fois en sécurité
 */
function attachGeolocationButton() {
  // Utiliser plusieurs sélecteurs pour être sûr de trouver le bouton
  const geolocBtn = document.getElementById('geolocationBtn') ||
    document.querySelector('button[aria-label*="تحديد موقعي"]') ||
    document.querySelector('button[onclick*="handleGeolocation"]') ||
    document.querySelector('.form-button-group .btn.primary');

  if (!geolocBtn) {
    console.warn('Bouton de géolocalisation non trouvé lors de l\'attachement');
    return;
  }

  if (geolocBtn.hasAttribute('data-geoloc-attached')) {
    console.log('Bouton déjà attaché');
    return;
  }

  // Marquer comme attaché pour éviter les doubles
  geolocBtn.setAttribute('data-geoloc-attached', 'true');

  // Retirer l'onclick si présent
  geolocBtn.removeAttribute('onclick');

  // Fonction pour gérer le clic - IMPORTANT: doit être appelée directement depuis un événement utilisateur
  const handleGeolocClick = function (e) {
    console.log('Clic sur le bouton de géolocalisation détecté');
    e.preventDefault();
    e.stopPropagation();
    // Appeler directement dans le contexte de l'événement utilisateur
    handleGeolocation();
  };

  // Ajouter plusieurs listeners pour meilleure compatibilité mobile
  // Utiliser 'click' qui fonctionne aussi pour les événements tactiles
  geolocBtn.addEventListener('click', handleGeolocClick, { passive: false, capture: false });

  // Ajouter aussi touchstart pour mobile (mais ne pas preventDefault pour permettre le click)
  geolocBtn.addEventListener('touchstart', function (e) {
    console.log('Touchstart détecté sur le bouton');
    // Ne pas preventDefault pour permettre le click de se déclencher aussi
  }, { passive: true });

  // S'assurer que le bouton est cliquable
  geolocBtn.style.cursor = 'pointer';
  geolocBtn.style.touchAction = 'manipulation';
  geolocBtn.style.webkitTapHighlightColor = 'transparent';
  geolocBtn.style.userSelect = 'none';
  geolocBtn.style.webkitUserSelect = 'none';

  console.log('Bouton de géolocalisation attaché avec succès:', geolocBtn);

  // Select on map button handling removed
}

function handleGeolocation() {
  console.log('handleGeolocation appelé');

  // Arrêter tout watchPosition en cours
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }

  // Selection mode handling removed

  // Vérifier le support de la géolocalisation
  if (!navigator.geolocation) {
    const errorMsg = 'المتصفح لا يدعم الموقع. يجب استخدام جهاز يدعم GPS.';
    console.error('Geolocation non supporté');
    showFormMessage(errorMsg, 'error');
    hapticFeedback('error');
    return;
  }

  // Vérifier si on est en HTTPS ou localhost (requis pour la géolocalisation)
  const isSecure = window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0';

  if (!isSecure) {
    const insecureMsg = '⚠️ يتطلب الموقع HTTPS للعمل على الهاتف. يرجى استخدام HTTPS.';
    console.warn('Géolocalisation nécessite HTTPS (sauf localhost)');
    showFormMessage(insecureMsg, 'error');
    return;
    return;
  }

  // Trouver le bouton de manière plus robuste (plusieurs sélecteurs pour mobile)
  const btn = document.querySelector('button[aria-label*="تحديد موقعي"]') ||
    document.querySelector('button[onclick*="handleGeolocation"]') ||
    document.querySelector('.form-button-group .btn.primary') ||
    document.querySelector('.form-button-group button:first-child');

  if (!btn) {
    console.error('Bouton de géolocalisation non trouvé');
    showFormMessage('خطأ في العثور على الزر', 'error');
    return;
  }

  console.log('Bouton trouvé:', btn);

  const originalHtml = btn.innerHTML;
  const originalDisabled = btn.disabled;

  // Feedback visuel immédiat
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري البحث...';
  btn.disabled = true;
  hapticFeedback('light');

  // Détection mobile améliorée
  const isMobile = window.matchMedia('(max-width: 1024px)').matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    ('ontouchstart' in window);

  console.log('Mobile détecté:', isMobile);
  console.log('User Agent:', navigator.userAgent);
  console.log('Protocol:', window.location.protocol);
  console.log('Hostname:', window.location.hostname);

  // Message informatif avec instructions pour mobile
  const helpMsg = isMobile
    ? 'جاري تحديد موقعك... يرجى السماح بالوصول إلى الموقع في إعدادات المتصفح وتأكد من تفعيل GPS.'
    : 'جاري تحديد موقعك... يرجى السماح بالوصول إلى الموقع.';
  showFormMessage(helpMsg, 'alert');

  // Options optimisées pour mobile - ACTIVER GPS avec enableHighAccuracy: true
  const options = {
    enableHighAccuracy: true,  // IMPORTANT: Activer pour utiliser le GPS réel sur mobile
    timeout: isMobile ? 60000 : 25000,  // 60 secondes sur mobile (plus de temps pour GPS), 25 sur desktop
    maximumAge: isMobile ? 0 : 30000  // 0 sur mobile (toujours obtenir une nouvelle position), 30 secondes sur desktop
  };

  console.log('Options de géolocalisation:', options);

  // Fonction pour traiter la position avec succès
  const handleSuccess = function (pos) {
    console.log('Position obtenue avec succès:', pos.coords);
    console.log('Précision:', pos.coords.accuracy, 'mètres');
    console.log('Source:', pos.coords.altitude !== null ? 'GPS' : 'Réseau');

    const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);

    // Vérifier que les coordonnées sont valides
    if (isNaN(latlng.lat) || isNaN(latlng.lng)) {
      console.error('Coordonnées invalides:', latlng);
      showFormMessage('خطأ: إحداثيات غير صحيحة', 'error');
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
      hapticFeedback('error');
      return;
    }

    // Vérifier que les coordonnées sont dans les limites de l'Algérie
    // Utiliser geojsonBounds si disponible, sinon APPROX_BOUNDS
    const checkBounds = geojsonBounds || APPROX_BOUNDS;
    if (checkBounds && !checkBounds.contains([latlng.lat, latlng.lng])) {
      console.warn('Position hors limites:', latlng);
      showFormMessage('موقعك خارج حدود الجزائر. يرجى التأكد من الموقع.', 'error');
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
      hapticFeedback('error');
      return;
    }

    // Arrêter watchPosition si actif
    if (watchPositionId !== null) {
      navigator.geolocation.clearWatch(watchPositionId);
      watchPositionId = null;
    }

    // Mettre à jour les champs
    // Update internal variables
    currentFormLat = latlng.lat;
    currentFormLng = latlng.lng;

    // Debug log
    console.log('Location updated:', currentFormLat, currentFormLng);

    // Calculer le niveau de zoom optimal selon la précision GPS
    // Plus la précision est bonne, plus on zoome
    const accuracy = pos.coords.accuracy;
    let zoomLevel;
    if (accuracy < 50) {
      zoomLevel = 17; // Très haute précision (GPS actif)
    } else if (accuracy < 100) {
      zoomLevel = 16; // Haute précision
    } else if (accuracy < 500) {
      zoomLevel = 14; // Précision moyenne
    } else {
      zoomLevel = 12; // Précision faible (réseau)
    }

    // Placer le marqueur temporaire ET centrer la carte avec le bon zoom
    setTempMarker(latlng, true, zoomLevel);

    // Mettre à jour le statut visuel
    const statusEl = document.getElementById('locationStatus');
    if (statusEl) {
      statusEl.innerHTML = `
            <div class="status-success">
                <i class="fas fa-check-circle"></i>
                <span>تم تحديد الموقع بدقة (${Math.round(accuracy)}m)</span>
            </div>
        `;
    }

    // Tenter de récupérer l'adresse automatiquement (Reverse Geocoding Client)
    // C'est juste pour aider l'utilisateur, le serveur fera le vrai geocoding
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latlng.lat}&lon=${latlng.lng}&accept-language=ar`)
      .then(res => res.json())
      .then(data => {
        const address = data.address || {};
        const city = address.city || address.town || address.village || address.municipality;
        const district = address.suburb || address.neighbourhood || address.city_district;
        // On récupère aussi la Wilaya (state)
        const state = address.state || address.region;

        // Mise à jour des variables globales pour l'envoi
        // Note: On pourrait stocker state ici si on voulait l'envoyer explicitement, 
        // mais le serveur le recalcule de toute façon.
        
        let displayAddress = '';
        if (city) displayAddress += city;
        if (district) displayAddress += (displayAddress ? '، ' : '') + district;
        if (state) displayAddress += (displayAddress ? ' (' + state + ')' : state);

        if (displayAddress) {
          const addrInput = document.getElementById('adresse');
          if (addrInput && !addrInput.value) {
            addrInput.value = displayAddress;
            // Petit effet visuel pour montrer que ça a été rempli
            addrInput.style.backgroundColor = '#ecfdf5';
            setTimeout(() => addrInput.style.backgroundColor = '', 1500);
            toast(`تم تحديد العنوان: ${displayAddress}`);
          }
        }
      })
      .catch(err => console.warn('Geocoding client failed:', err));

    // Feedback de succès avec info sur la précision
    const accuracyMsg = pos.coords.accuracy < 50
      ? '✅ تم تحديد الموقع بدقة عالية!'
      : '✅ تم تحديد الموقع بنجاح!';
    showFormMessage(accuracyMsg, 'success');
    hapticFeedback('success');

    // Restaurer le bouton
    btn.innerHTML = originalHtml;
    btn.disabled = originalDisabled;

    // Valider le formulaire
    validateForm();
  };

  // Fonction pour gérer les erreurs
  const handleError = function (err) {
    console.error('Erreur de géolocalisation:', err);
    let errMsg = 'فشل في الحصول على الموقع.';
    let showRetry = false;

    switch (err.code) {
      case 1: // PERMISSION_DENIED
        errMsg = 'تم رفض الوصول إلى الموقع. يرجى السماح بالوصول في إعدادات المتصفح ثم المحاولة مرة أخرى.';
        console.error('Permission refusée');
        showRetry = true;
        break;
      case 2: // POSITION_UNAVAILABLE
        errMsg = 'الموقع غير متوفر. يرجى تفعيل GPS في إعدادات الهاتف ثم النقر على "تحديد موقعي" مرة أخرى.';
        console.error('Position non disponible (GPS probablement éteint)');
        showRetry = true;

        // Sur mobile, on réessaie quand même une fois avec watchPosition au cas où
        if (isMobile) {
          console.log('Tentative avec watchPosition comme fallback...');

          // Si c'est la première tentative de fallback, on essaie silencieusement
          if (watchPositionId === null) {
            showFormMessage('جاري تفعيل GPS... (قد يستغرق دقيقة)', 'alert');

            // TENTATIVE DE RECUPERATION AVEC OPTIONS PLUS LARGES
            const fallbackOptions = {
              enableHighAccuracy: true, // On insiste sur le GPS
              timeout: 60000,
              maximumAge: 0
            };

            watchPositionId = navigator.geolocation.watchPosition(
              handleSuccess,
              function (watchErr) {
                console.error('Erreur watchPosition:', watchErr);

                // Si échec total du GPS, tenter une dernière fois en mode "basse précision" (Wifi/Réseau)
                if (watchErr.code === 3 || watchErr.code === 2) {
                  console.log('Echec GPS, tentative basse précision...');
                  navigator.geolocation.getCurrentPosition(
                    handleSuccess,
                    function (finalErr) {
                      // Echec final
                      let finalMsg = 'فشل تحديد الموقع بدقة. يرجى تفعيل GPS والمحاولة مرة أخرى.';
                      if (finalErr.code === 1) finalMsg = 'تم رفض الإذن. يرجى تفعيل الموقع للمتصفح.';

                      showFormMessage(finalMsg, 'error');

                      btn.innerHTML = '<i class="fas fa-redo"></i> إعادة المحاولة';
                      btn.onclick = function () { handleGeolocation(); };
                      btn.disabled = false;
                    },
                    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
                  );
                  return;
                }

                showFormMessage('فشل تحديد الموقع. يرجى تفعيل GPS.', 'error');
                btn.innerHTML = originalHtml;
                btn.disabled = originalDisabled;

                if (watchPositionId !== null) {
                  navigator.geolocation.clearWatch(watchPositionId);
                  watchPositionId = null;
                }
              },
              fallbackOptions
            );
            return; // Ne pas restaurer le bouton maintenant
          }
        }
        break;
      case 3: // TIMEOUT
        errMsg = 'انتهت المهلة. تأكد من تفعيل GPS وحاول مرة أخرى.';
        console.error('Timeout');
        showRetry = true;

        // Sur mobile, essayer avec watchPosition comme fallback
        if (isMobile) {
          console.log('Timeout - Tentative avec watchPosition...');
          showFormMessage('تأكد من تفعيل GPS... جاري المحاولة...', 'alert');
          watchPositionId = navigator.geolocation.watchPosition(
            handleSuccess,
            function (watchErr) {
              console.error('Erreur watchPosition après timeout:', watchErr);
              showFormMessage('تعذر تحديد الموقع. يرجى التحقق من GPS والمحاولة مجدداً.', 'error');
              hapticFeedback('error');
              btn.innerHTML = '<i class="fas fa-redo"></i> محاولة مجدداً';
              btn.disabled = false;
              // Réattacher l'événement click standard si besoin, ou laisser le bouton actif
              btn.onclick = function () { handleGeolocation(); };

              if (watchPositionId !== null) {
                navigator.geolocation.clearWatch(watchPositionId);
                watchPositionId = null;
              }
            },
            {
              enableHighAccuracy: true,
              timeout: 60000,
              maximumAge: 0
            }
          );
          return; // Ne pas restaurer le bouton maintenant
        }
        break;
      default:
        errMsg = `خطأ غير معروف (${err.code}). يرجى المحاولة مرة أخرى.`;
        console.error('Erreur inconnue:', err);
        showRetry = true;
    }

    showFormMessage(errMsg, 'error');
    hapticFeedback('error');

    if (showRetry) {
      // Proposer de réessayer au lieu de restaurer simplement
      btn.innerHTML = '<i class="fas fa-redo"></i> تفعيل GPS والمحاولة';
      btn.disabled = false;
      // On s'assure que le clic relance la géolocalisation
      btn.onclick = function (e) {
        e.preventDefault();
        handleGeolocation();
      };
    } else {
      // En cas d'erreur irrécupérable, on force le message d'erreur strict
      showFormMessage('❌ عذراً، لا يمكن إضافة شجرة بدون تحديد موقع GPS دقيق. يرجى تفعيل الموقع.', 'error');
      // Restaurer le bouton original
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
    }
  };

  // Essayer d'abord avec getCurrentPosition
  navigator.geolocation.getCurrentPosition(
    handleSuccess,
    handleError,
    options
  );
}

/* Fonction toggleMapSelectionMode supprimée car le mode manuel est désactivé */
// Duplicate function removed


/* --------------------------------- */
/* Gestion du Cache Local (Fallback) */
/* --------------------------------- */

/**
 * Sauvegarde les données en cache local (pour mode hors-ligne)
 * NOTE: Ce n'est PAS la source de vérité, juste un cache
 */
function saveToLocalCache() {
  try { 
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); 
  } catch (e) { 
    console.warn('Cache local non disponible:', e); 
  }
}

/**
 * Charge les données depuis le cache local (fallback si serveur indisponible)
 * @returns {Array} Les entrées en cache ou un tableau vide
 */
function loadFromLocalCache() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { 
      const cached = JSON.parse(raw);
      return cached.map(e => ({ ...e, quantite: parseInt(e.quantite) || 1 }));
    } catch (e) { 
      console.warn('Erreur parsing cache:', e); 
      return []; 
    }
  }
  return [];
}

/**
 * @deprecated Utilisez saveToLocalCache() à la place
 * Gardé pour compatibilité avec le code existant
 */
function saveToStorage() {
  saveToLocalCache();
}

/**
 * @deprecated Utilisez loadFromLocalCache() à la place
 * Gardé pour compatibilité avec le code existant
 */
function loadFromStorage() {
  const cached = loadFromLocalCache();
  if (cached.length > 0) {
    entries = cached;
    markerCluster.clearLayers();
    entries.forEach(e => addEntryToMap(e));
    applyFiltersAndSort();
  }
}

function updateStats(filteredCount = entries.length) {
  if (!entries) entries = [];
  const safeEntries = Array.isArray(entries) ? entries : [];

  const totalTrees = safeEntries.reduce((sum, entry) => sum + (parseInt(entry.quantite) || 0), 0);

  const countEl = document.getElementById('stat-count');
  if (countEl) countEl.textContent = safeEntries.length;

  const totalEl = document.getElementById('stat-total-trees');
  if (totalEl) totalEl.textContent = totalTrees.toLocaleString();

  const types = new Set(safeEntries.map(e => e.type).filter(t => t));
  const typesEl = document.getElementById('stat-types');
  if (typesEl) typesEl.textContent = types.size;

  const updateEl = document.getElementById('lastUpdate');
  if (updateEl) updateEl.textContent = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Algiers' });

  const filterEl = document.getElementById('filterInfo');
  if (filterEl) filterEl.textContent = (filteredCount < safeEntries.length) ? `(${filteredCount} نتيجة من ${safeEntries.length})` : `الكل (${safeEntries.length})`;

  const resultsEl = document.getElementById('resultsCount');
  if (resultsEl) resultsEl.textContent = filteredCount;

  // Mise à jour des graphiques
  updateCharts(safeEntries);
}

/**
 * Génère et met à jour les graphiques Chart.js
 */
function updateCharts(data) {
  // --- 1. Préparation des données pour les TYPES (Donut) ---
  const typeCounts = {};
  data.forEach(e => {
    // Nettoyer et normaliser le type
    let t = (e.type || 'غير محدد').trim();
    typeCounts[t] = (typeCounts[t] || 0) + (parseInt(e.quantite) || 1);
  });

  // Trier par nombre décroissant
  const sortedTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1]);

  const typeLabels = sortedTypes.map(item => item[0]);
  const typeData = sortedTypes.map(item => item[1]);

  // Palette de couleurs variée et naturelle pour le Donut
  const variedPalette = [
    '#059669', // Vert émeraude (Principal)
    '#d97706', // Ambre (Terre/Automne)
    '#3b82f6', // Bleu (Eau/Ciel)
    '#8b5cf6', // Violet (Fleurs)
    '#ec4899', // Rose (Fleurs)
    '#14b8a6', // Sarcelle
    '#f59e0b', // Orange clair
    '#6366f1', // Indigo
    '#84cc16', // Citron vert
    '#64748b'  // Gris ardoise (Autre)
  ];



  // --- 3. Rendu / Mise à jour du Graphique TYPES (Donut) ---
  const ctxTypes = document.getElementById('typesChart');
  if (ctxTypes) {
    if (typesChartInstance) {
      typesChartInstance.destroy(); // Détruire l'ancien pour éviter les bugs
    }
    
    // Configuration police
    Chart.defaults.font.family = "'Cairo', sans-serif";
    
    typesChartInstance = new Chart(ctxTypes, {
      type: 'doughnut',
      data: {
        labels: typeLabels,
        datasets: [{
          data: typeData,
          backgroundColor: variedPalette,
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { boxWidth: 12, font: { size: 11 }, padding: 15 },
            rtl: true // Support RTL pour l'arabe
          },
          tooltip: {
             rtl: true,
             callbacks: {
                label: function(context) {
                    let label = context.label || '';
                    if (label) {
                        label += ': ';
                    }
                    let value = context.raw;
                    let total = context.chart._metasets[context.datasetIndex].total;
                    let percentage = Math.round((value / total) * 100) + '%';
                    return label + value + ' شجرة (' + percentage + ')';
                }
             }
          }
        },
        layout: { padding: 0 }
      }
    });
  }

}

/* --------------------------------- */
/* Filtres et Affichage de Liste     */
/* --------------------------------- */

function applyFiltersAndSort() {
  let filtered = [...entries];
  const quickSearchEl = document.getElementById('quickSearch');
  const typeFilterEl = document.getElementById('typeFilter');
  const wilayaFilterEl = document.getElementById('wilayaFilter');
  const sortOrderEl = document.getElementById('sortOrder');
  
  const query = (quickSearchEl ? quickSearchEl.value || '' : '').toLowerCase().trim();
  const typeFilter = typeFilterEl ? typeFilterEl.value : '';
  const wilayaFilter = wilayaFilterEl ? wilayaFilterEl.value : '';
  const sortOrder = sortOrderEl ? sortOrderEl.value : 'createdAt';

  if (query) {
    filtered = filtered.filter(e => (
      (e.nom || '') + ' ' + (e.adresse || '') + ' ' + (e.type || '')
    ).toLowerCase().includes(query));
  }
  
  if (typeFilter) {
    // Nettoyage pour comparaison (on enlève les émojis et les espaces pour être sûr)
    const cleanTypeFilter = typeFilter.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
    
    filtered = filtered.filter(e => {
      if (!e.type) return false;
      const cleanEntryType = e.type.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
      return cleanEntryType === cleanTypeFilter || e.type.trim() === typeFilter.trim();
    });
  }

  if (wilayaFilter) {
    // Récupération propre du nom de la wilaya depuis DZ_DATA
    let target = '';
    if (typeof DZ_DATA !== 'undefined' && DZ_DATA[wilayaFilter]) {
      target = DZ_DATA[wilayaFilter].ar.toLowerCase();
    } else {
      // Fallback si Tom Select ou DZ_DATA n'est pas dispo comme attendu
      const selectedOption = wilayaFilterEl.options[wilayaFilterEl.selectedIndex];
      const selectedText = selectedOption ? selectedOption.text : '';
      target = (selectedText.includes('-') ? selectedText.split('-')[1].trim() : selectedText).toLowerCase();
    }
    
    filtered = filtered.filter(e => {
      const state = (e.state || '').toLowerCase();
      const addr = (e.adresse || '').toLowerCase();
      return state.includes(target) || addr.includes(target);
    });
  }

  filtered.sort((a, b) => {
    if (sortOrder === 'nom') return (a.nom || '').localeCompare(b.nom || '');
    if (sortOrder === 'type') return (a.type || '').localeCompare(b.type || '');
    const timeA = a.createdAt || a.timestamp || 0;
    const timeB = b.createdAt || b.timestamp || 0;
    return new Date(timeB) - new Date(timeA);
  });

  updateList(filtered);
  updateMapMarkers(filtered.map(e => e.id));
  updateStats(filtered.length);
}

/**
 * Met à jour la liste latérale (Le clic ouvre le panneau de détail)
 */
function updateList(filteredEntries) {
  const container = document.getElementById('locationsList');
  if (!container) return;
  container.innerHTML = '';

  if (!filteredEntries || !Array.isArray(filteredEntries)) {
    filteredEntries = [];
  }

  const items = filteredEntries.slice(0, 50);

  if (items.length === 0) {
    container.innerHTML = `
      <div class="no-results" style="text-align:center; padding: 40px 20px; color: var(--color-text-muted);">
        <i class="fas fa-search" style="font-size: 3rem; opacity: 0.1; margin-bottom: 15px; display: block;"></i>
        <p style="font-weight: 700;">لا توجد نتائج مطابقة لبحثك</p>
        <p style="font-size: 0.85rem;">حاول تغيير معايير البحث أو الفلاتر</p>
      </div>
    `;
    return;
  }

  items.forEach(e => {
    const div = document.createElement('div');
    div.className = 'location-item';
    div.setAttribute('data-id', e.id);
    div.setAttribute('role', 'listitem');
    div.setAttribute('tabindex', '0');

    div.onclick = (event) => {
      if (!event.target.closest('.actions-mini button')) {
        centerAndOpenPanel(e.id);
      }
    };

    let photoUrl = e.photo;
    if (photoUrl && photoUrl.includes('http://localhost') && window.location.hostname !== 'localhost') {
      const filename = photoUrl.split('/').pop();
      if (filename && !filename.includes('http')) {
        photoUrl = `${API_URL.replace('/api/contributions', '')}/uploads/${filename}`;
      } else {
        photoUrl = null;
      }
    }

    const img = document.createElement('img');
    img.src = photoUrl ? photoUrl + '?w=200' : 'https://via.placeholder.com/200x200?text=No+Image';
    img.alt = e.type || 'شجرة';
    img.onerror = () => { img.src = 'https://via.placeholder.com/200x200?text=Error'; };

    const typeIcon = getTreeIconClass(e.type);
    const locationInfo = [e.city, e.district].filter(Boolean).join('، ') || 'منطقة غير محددة';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `
      <h4><i class="${typeIcon} type-icon"></i> ${escapeHtml(e.type)}</h4>
      <p title="${escapeHtml(e.nom)}">${escapeHtml(e.nom)}</p>
      
      <div class="info-row">
        <div class="info-tag"><i class="fas fa-layer-group"></i> ${e.quantite} شجرة</div>
        <div class="info-tag"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(locationInfo)}</div>
      </div>
      
      <div class="info-row">
        <div class="info-tag"><i class="fas fa-calendar-alt"></i> ${formatDate(e.createdAt || e.timestamp)}</div>
      </div>

      <div class="actions-mini">
        <button class="btn-mini-action" title="تحديد على الخريطة" onclick="centerAndOpenPopup('${e.id}')">
          <i class="fas fa-crosshairs"></i>
        </button>
        <button class="btn-mini-action view-btn" title="عرض التفاصيل" onclick="centerAndOpenPanel('${e.id}')">
          <i class="fas fa-eye"></i>
        </button>
      </div>
    `;

    div.appendChild(img);
    div.appendChild(meta);
    container.appendChild(div);
  });
}

function updateMapMarkers(visibleIds) {
  markerCluster.clearLayers();
  entries.forEach(entry => {
    if (visibleIds.includes(entry.id)) {
      addEntryToMap(entry);
    }
  });
}


/* --------------------------------- */
/* Gestion UX/UI Mobile (Bottom Sheet) */
/* --------------------------------- */

function toggleSidebar(visible, initialPanel = 'form-panel') {
  const sidebar = document.getElementById('sidebar');
  const mobileNav = document.getElementById('mobileNav');
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;

  // DEBUG: Vérifier quel panneau est demandé
  if (isMobile && visible) {
    console.log('toggleSidebar MOBILE - panneau demandé:', initialPanel);
  }

  // Sur desktop, on change juste le panneau sans toggle la visibilité
  if (!isMobile) {
    if (visible && initialPanel) {
      switchPanel(initialPanel);
    }
    return;
  }

  if (visible) {
    // Sécurité: si un swipe avait mis des styles inline, on les nettoie
    sidebar.style.transition = '';
    sidebar.style.transform = '';
    sidebar.style.willChange = '';

    sidebar.classList.add('visible');
    document.body.classList.add('sidebar-open');
    // Mobile UX: ne montrer que l'onglet actif dans la barre mobile
    if (mobileNav) mobileNav.classList.add('single-only');
    // Trouver l'onglet correspondant pour garantir le bon "active" - FORCER le changement
    const clickedNavItem = document.querySelector(`.mobile-nav-item[data-target="${initialPanel}"]`);
    // S'assurer que tous les onglets sont désactivés d'abord
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.classList.remove('active');
      item.setAttribute('aria-selected', 'false');
    });
    // Activer le bon onglet AVANT d'appeler switchPanel
    if (clickedNavItem) {
      clickedNavItem.classList.add('active');
      clickedNavItem.setAttribute('aria-selected', 'true');
    }
    // Maintenant changer le panneau
    switchPanel(initialPanel, clickedNavItem || null);
    // Ne pas bloquer le scroll du body pour permettre l'interaction avec la carte
    // document.body.style.overflow = 'hidden'; // Commenté pour permettre le scroll de la carte
    // Overlay optionnel et transparent pour ne pas bloquer les interactions
    const mapwrap = document.querySelector('.mapwrap');
    if (mapwrap) {
      let overlay = mapwrap.querySelector('.sidebar-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        // Overlay transparent avec pointer-events: none pour ne pas bloquer la carte
        overlay.style.cssText = 'position: absolute; inset: 0; background: rgba(0, 0, 0, 0.1); z-index: 1400; pointer-events: none; animation: fadeIn 0.3s ease-out;';
        mapwrap.appendChild(overlay);
      }
      overlay.style.display = 'block';
    }
  } else {
    // Sécurité: si un swipe avait mis des styles inline, on les nettoie
    sidebar.style.transition = '';
    sidebar.style.transform = '';
    sidebar.style.willChange = '';

    sidebar.classList.remove('visible');
    document.body.classList.remove('sidebar-open');
    document.body.style.overflow = '';
    // Garder "single-only" même après fermeture (comportement demandé)
    // => l'onglet visible reste celui actif (Statistiques / Contributions / Ajouter).
    // Retirer overlay
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }
}

/* Support du swipe pour fermer la sidebar */
let touchStartY = 0;
let touchStartX = 0;
let isSwiping = false;

document.addEventListener('DOMContentLoaded', function () {
  const sidebar = document.getElementById('sidebar');
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;

  if (!isMobile || !sidebar) return;

  // Gestion du swipe vers la gauche pour fermer (panneau latéral)
  sidebar.addEventListener('touchstart', function (e) {
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    isSwiping = false;

    // IMPORTANT (perf/UX): pendant le drag, on désactive les transitions
    // sinon chaque update de `transform` est animée et ça donne une fermeture "lente".
    sidebar.style.willChange = 'transform';
    sidebar.style.transition = 'none';
  }, { passive: true });

  sidebar.addEventListener('touchmove', function (e) {
    if (!touchStartX) return;

    const touchY = e.touches[0].clientY;
    const touchX = e.touches[0].clientX;
    const deltaX = touchStartX - touchX; // Négatif = swipe vers la gauche
    const deltaY = Math.abs(touchY - touchStartY);

    // Détecter un swipe vers la gauche (plus de mouvement horizontal que vertical)
    if (deltaX > 10 && deltaX > deltaY) {
      isSwiping = true;
      // Appliquer une transformation visuelle pendant le swipe
      e.preventDefault();
      const translateX = Math.max(-deltaX, -sidebar.offsetWidth);
      sidebar.style.transform = `translateX(${translateX}px)`;
    }
  }, { passive: false });

  sidebar.addEventListener('touchend', function (e) {
    if (!touchStartX) return;

    const touchX = e.changedTouches[0].clientX;
    const deltaX = touchStartX - touchX;

    // Si swipe vers la gauche de plus de 50px, fermer la sidebar
    if (isSwiping && deltaX > 50) {
      // Réactiver les transitions AVANT la fermeture animée
      sidebar.style.transition = '';
      // D'abord enlever la classe (nouvel état CSS), puis relâcher le transform inline
      // au frame suivant pour que la transition se fasse depuis la position drag.
      toggleSidebar(false);
      requestAnimationFrame(() => {
        sidebar.style.transform = '';
        sidebar.style.willChange = '';
      });
    } else {
      // Réinitialiser la transformation (retour "snap" + animé via CSS)
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      sidebar.style.willChange = '';
    }

    touchStartX = 0;
    touchStartY = 0;
    isSwiping = false;
  }, { passive: true });

  // Fermer la sidebar en cliquant sur l'overlay (zone sombre)
  const mapwrap = document.querySelector('.mapwrap');
  if (mapwrap) {
    // Utiliser la délégation d'événements pour l'overlay
    mapwrap.addEventListener('click', function (e) {
      if (e.target.classList.contains('sidebar-overlay')) {
        toggleSidebar(false);
      }
    });
  }
});

function switchPanel(targetId, clickedElement = null) {
  const panels = document.querySelectorAll('.mobile-panel');
  const navItems = document.querySelectorAll('.mobile-nav-item');
  const detailNav = document.getElementById('detailNav');
  const mobileNav = document.getElementById('mobileNav');
  const sidebar = document.getElementById('sidebar');
  const isDetailPanel = targetId === 'detail-panel';

  // DEBUG: Vérifier quel panneau est appelé
  console.log('switchPanel appelé avec:', targetId);

  // Haptic feedback sur mobile
  hapticFeedback('light');

  // 1. Gérer l'affichage du panneau (Simple et robuste)
  panels.forEach(panel => {
    if (panel.id === targetId) {
      panel.style.display = 'block';
      panel.style.opacity = '1';
      panel.style.transform = 'none';
      // Force repaint
      void panel.offsetWidth;
    } else {
      panel.style.display = 'none';
    }
  });

  // 2. Gérer la navigation mobile
  navItems.forEach(item => {
    item.classList.remove('active');
    item.setAttribute('aria-selected', 'false');
  });

  if (isDetailPanel) {
    // Le panneau Détail est un onglet "spécial" qui apparaît temporairement
    detailNav.style.display = 'flex';
    detailNav.classList.add('active');
    detailNav.setAttribute('aria-selected', 'true');
  } else {
    // Les onglets normaux
    detailNav.style.display = 'none';
    let currentItem = clickedElement;
    if (!currentItem) {
      currentItem = document.querySelector(`.mobile-nav-item[data-target="${targetId}"]`);
    }
    if (currentItem) {
      currentItem.classList.add('active');
      currentItem.setAttribute('aria-selected', 'true');
    }
  }

  // 2.5. Mobile: afficher uniquement l'onglet actif (persistant, même après fermeture)
  // (ce que tu veux: Statistiques => فقط Statistiques, Contributions => فقط Contributions, etc.)
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;
  if (isMobile && mobileNav) {
    mobileNav.classList.add('single-only');
  }


  // 3. Assurer la mise à jour des données lors du changement vers l'onglet List/Stats
  if (targetId === 'list-panel' || targetId === 'stats-panel') {
    try {
      applyFiltersAndSort();
      
      // 🔹 Forcer la mise à jour des graphiques quand on ouvre les Stats
      if (targetId === 'stats-panel') {
        setTimeout(() => {
          console.log('📊 Actualisation graphiques (stats-panel ouvert)');
          updateCharts(entries);
        }, 100); // Petit délai pour que le panneau soit visible
      }
    } catch (err) {
      console.error('Error updating list/stats:', err);
      toast('حدث خطأ في عرض البيانات', 'error');
    }
  }
}

// Preview de l'image
// Prévisualisation de la photo dans le formulaire principal (robuste)
const photoInputEl = document.getElementById('photo');
if (photoInputEl) {
  photoInputEl.addEventListener('change', function (event) {
    const preview = document.getElementById('preview');
    if (!preview) return;

    const input = event.target;
    if (input && input.files && input.files.length > 0) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = function (e) {
        preview.src = e.target.result;
        preview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      preview.src = '';
      preview.style.display = 'none';
    }
  });
} else {
  console.warn('Input #photo introuvable: preview désactivée');
}

// Prévisualisation de la photo dans le modal d'édition
const editPhotoInput = document.getElementById('editPhoto');
if (editPhotoInput) {
  editPhotoInput.addEventListener('change', function (event) {
    const file = event.target.files[0];
    const preview = document.getElementById('editPhotoPreview');
    const previewImg = document.getElementById('editPhotoPreviewImg');
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        previewImg.src = e.target.result;
        preview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      preview.style.display = 'none';
    }
  });
}


/* --------------------------------- */
/* Outils de Carte                   */
/* --------------------------------- */
function fitAllMarkers() {
  const layers = markerCluster.getLayers();
  if (layers.length === 0) { toast('لا توجد مساهمات لعرضها على الخريطة.', 'alert'); return; }
  const bounds = L.latLngBounds(layers.map(m => m.getLatLng()));
  map.fitBounds(bounds.pad(0.25));
}
function zoomToAlgeria() {
  if (geojsonBounds) map.fitBounds(geojsonBounds.pad(0.02));
  else map.setView(ALGERIA_CENTER, 5);
}
let heatOn = false;
function toggleHeatmap() {
  heatOn = !heatOn;
  const toggleBtn = document.getElementById('toggleHeat');
  if (heatOn) {
    const pts = entries.map(e => [e.lat, e.lng, 0.6]);
    heatLayer.setLatLngs(pts);
    heatLayer.addTo(map);
    toggleBtn.classList.add('active');
    toggleBtn.setAttribute('aria-pressed', 'true');
    toast('خريطة الحرارة مفعلة');
  } else {
    map.removeLayer(heatLayer);
    toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-pressed', 'false');
    toast('خريطة الحرارة معطلة');
  }
}
let dark = false;
function toggleStyle() {
  dark = !dark;
  const toggleBtn = document.getElementById('toggleStyle');
  if (dark) {
    map.removeLayer(tileDefault);
    tileToner.addTo(map);
    toast('سمة داكنة', 'alert');
    toggleBtn.classList.add('active');
    toggleBtn.setAttribute('aria-pressed', 'true');
  }
  else {
    map.removeLayer(tileToner);
    tileDefault.addTo(map);
    toast('سمة افتراضية');
    toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-pressed', 'false');
  }
}


/* --------------------------------- */
/* Import/Export                     */
/* --------------------------------- */
function exportData() {
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'algerie_verte_export.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('تم تصدير البيانات بنجاح.', 'success');
}
function importData(evt) {
  const f = evt.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed)) throw new Error('تنسيق الملف غير صحيح.');

      let importedCount = 0;
      parsed.forEach(p => {
        if (!p.id) p.id = 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        p.quantite = parseInt(p.quantite) || 1;

        if (!entries.find(ex => ex.id === p.id)) {
          entries.unshift(p);
          addEntryToMap(p);
          importedCount++;
        }
      });
      saveToStorage();
      applyFiltersAndSort();
      toast(`✅ تم استيراد ${importedCount} مساهمة.`, 'success');
      document.getElementById('importFile').value = '';
    } catch (err) {
      toast('خطأ في ملف الاستيراد: ' + err.message, 'error');
      document.getElementById('importFile').value = '';
    }
  };
  r.readAsText(f);
}
function clearAllData() {
  if (!confirm('هل تريد مسح كل البيانات المحفوظة محلياً؟ هذا الإجراء لا يمكن التراجع عنه!')) return;
  entries = []; saveToStorage(); markerCluster.clearLayers(); applyFiltersAndSort(); toast('تم مسح كل البيانات.', 'error');
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
}


/* --------------------------------- */
/* Initialisation                    */
/* --------------------------------- */
document.addEventListener('DOMContentLoaded', function () {
  // FAB Event Listeners (Fixed for Mobile) with specific IDs
  // Moved to top to ensure availability
  ['fab-add', 'fab-list', 'fab-stats'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      // Utiliser à la fois click et touchend pour garantir la réactivité sur mobile
      const handler = function (e) {
        e.preventDefault();
        e.stopPropagation(); // Éviter la propagation qui pourrait fermer la sidebar

        if (id === 'fab-add') toggleSidebar(true, 'form-panel');
        else if (id === 'fab-list') toggleSidebar(true, 'list-panel');
        else if (id === 'fab-stats') toggleSidebar(true, 'stats-panel');
      };

      el.addEventListener('click', handler);
      el.addEventListener('touchend', handler);

      // Force le curseur pointer pour l'UI
      el.style.cursor = 'pointer';
    }
  });

  initMap();

  // Pré-remplir la liste des options de filtre de type
  const typeFilterSelect = document.getElementById('typeFilter');
  if (typeFilterSelect) {
    const existingTypes = new Set(Array.from(typeFilterSelect.options).map(o => o.value).filter(v => v));

    document.getElementById('type_arbre').querySelectorAll('option').forEach(option => {
      const val = option.value || option.textContent;
      if (val && val !== "اختر نوع الشجرة" && !existingTypes.has(val)) {
        const newOption = document.createElement('option');
        newOption.value = val;
        newOption.textContent = option.textContent;
        typeFilterSelect.appendChild(newOption);
        existingTypes.add(val);
      }
    });

    // Initialiser Tom Select pour le filtre de Type pour une recherche fluide
    if (typeof TomSelect !== 'undefined') {
      new TomSelect('#typeFilter', {
        create: false,
        placeholder: 'كل أنواع الأشجار',
        onChange: () => applyFiltersAndSort()
      });
    }
  }

  // Pré-remplir la liste des options de filtre de Wilaya
  const wilayaFilterSelect = document.getElementById('wilayaFilter');
  if (wilayaFilterSelect && typeof DZ_DATA !== 'undefined') {
    const sortedIds = Object.keys(DZ_DATA).sort((a,b) => parseInt(a)-parseInt(b));
    sortedIds.forEach(id => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${id} - ${DZ_DATA[id].ar}`;
      wilayaFilterSelect.appendChild(option);
    });

    // Initialiser Tom Select pour le filtre de Wilaya pour avoir la recherche
    if (typeof TomSelect !== 'undefined') {
      new TomSelect('#wilayaFilter', {
        create: false,
        sortField: { field: "text", direction: "asc" },
        placeholder: 'كل الولايات (بحث...)',
        onChange: () => applyFiltersAndSort()
      });
    }
  }

  // Gérer l'ouverture initiale du sidebar sur desktop (pour l'affichage du formulaire)
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;
  if (!isMobile) {
    switchPanel('form-panel');
  }

  // Pull-to-refresh pour la liste
  if (isMobile) {
    initPullToRefresh();
  }

  // Gestion du clavier virtuel mobile
  initKeyboardHandling();

  // Gestion de l'orientation
  window.addEventListener('orientationchange', handleOrientationChange);
  handleOrientationChange();

  // Attacher le bouton de géolocalisation après l'initialisation complète
  // Attendre un peu pour s'assurer que tous les éléments sont chargés (important pour mobile)
  setTimeout(function () {
    attachGeolocationButton();
  }, 300);

  // Exemple : charger une contribution depuis MongoDB (photo Base64 affichée dans la section dédiée)
  loadRemoteSample();

  // Initialisation du calendrier moderne Flatpickr
  initFlatpickr();

  // NB: Les listeners FAB sont déjà attachés plus haut dans ce même DOMContentLoaded.
  // On évite les doubles handlers (click + touchend + click) qui peuvent provoquer des comportements bizarres sur mobile.
});

function initFlatpickr() {
  if (typeof flatpickr !== 'undefined') {
    const commonConfig = {
      locale: "ar", // Langue arabe
      altInput: true, // Afficher une version formatée
      altFormat: "j F Y", // ex: 15 mars 2025
      dateFormat: "Y-m-d", // Format envoyé au backend (YYYY-MM-DD)
      maxDate: "today", // Pas de futur
      disableMobile: false, // Utiliser le calendrier custom même sur mobile (plus joli)
      theme: "material_green", // Thème de base (sera surchargé par CSS)
    };

    // Champ principal
    flatpickr("#date_planted", commonConfig);

    // Champ édition (si présent)
    const editDateInput = document.getElementById("editDatePlanted");
    if (editDateInput) {
      flatpickr("#editDatePlanted", commonConfig);
    }
  }
}

/* Pull-to-refresh functionality */
function initPullToRefresh() {
  const locationsList = document.getElementById('locationsList');
  if (!locationsList) return;

  let pullStartY = 0;
  let pullDistance = 0;
  let isPulling = false;
  let pullRefreshElement = null;

  // Créer l'élément pull-refresh
  pullRefreshElement = document.createElement('div');
  pullRefreshElement.className = 'pull-refresh';
  pullRefreshElement.innerHTML = '<i class="fas fa-sync-alt"></i> <span>جاري التحديث...</span>';
  document.body.appendChild(pullRefreshElement);

  locationsList.addEventListener('touchstart', function (e) {
    if (locationsList.scrollTop === 0) {
      pullStartY = e.touches[0].clientY;
      isPulling = false;
    }
  }, { passive: true });

  locationsList.addEventListener('touchmove', function (e) {
    if (pullStartY === 0) return;

    const touchY = e.touches[0].clientY;
    pullDistance = touchY - pullStartY;

    if (locationsList.scrollTop === 0 && pullDistance > 0) {
      isPulling = true;
      const pullAmount = Math.min(pullDistance, 80);

      if (pullAmount > 50) {
        pullRefreshElement.classList.add('active');
      } else {
        pullRefreshElement.classList.remove('active');
      }
    }
  }, { passive: true });

  locationsList.addEventListener('touchend', function (e) {
    if (isPulling && pullDistance > 50) {
      pullRefreshElement.classList.add('active');
      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate([10, 20, 10]);
      }
      // Rafraîchir les données
      applyFiltersAndSort();
      setTimeout(() => {
        pullRefreshElement.classList.remove('active');
      }, 1000);
    }
    pullStartY = 0;
    pullDistance = 0;
    isPulling = false;
  }, { passive: true });
}

/* Gestion du clavier virtuel mobile */
function initKeyboardHandling() {
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;
  if (!isMobile) return;

  const inputs = document.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    input.addEventListener('focus', function () {
      // Scroll vers l'input pour qu'il soit visible
      setTimeout(() => {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    });

    // Gérer la soumission du formulaire avec Enter
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const form = e.target.closest('form');
        if (form) {
          e.preventDefault();
          const submitBtn = form.querySelector('button[type="submit"]');
          if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
          }
        }
      }
    });
  });
}

/* Gestion du changement d'orientation */
function handleOrientationChange() {
  const isMobile = window.matchMedia('(max-width: 1024px)').matches;
  if (!isMobile) return;

  // Ajuster la hauteur de la sidebar selon l'orientation
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('visible')) {
    // Forcer un recalcul de la hauteur
    setTimeout(() => {
      const sidebarContent = sidebar.querySelector('.sidebar-content');
      if (sidebarContent) {
        sidebarContent.style.maxHeight = window.innerHeight * 0.8 + 'px';
      }
    }, 100);
  }

  // Ajuster la carte
  if (map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  }
}

/**
 * 🔹 Gestion de l'ajout (Création) - ENVOIE AU SERVEUR D'ABORD
 */
async function handleSubmit() {
  const nom = document.getElementById('nom').value.trim();
  const adresse = document.getElementById('adresse').value.trim();
  const type = document.getElementById('type_arbre').value.trim();
  const quantite = parseInt(document.getElementById('quantite').value, 10);
  const lat = currentFormLat !== null ? currentFormLat : parseFloat('NaN');
  const lng = currentFormLng !== null ? currentFormLng : parseFloat('NaN');
  const datePlanted = document.getElementById('date_planted').value || null;
  const photoInput = document.getElementById('photo');
  const photoFile = photoInput.files[0];

  // Validation
  if (!nom || !type) {
    showFormMessage('الاسم ونوع الشجرة مطلوبان', 'error');
    hapticFeedback('error');
    return;
  }
  if (isNaN(quantite) || quantite < 1) {
    showFormMessage('الرجاء تحديد عدد الأشجار (1 على الأقل)', 'error');
    hapticFeedback('error');
    return;
  }
  if (isNaN(lat) || isNaN(lng)) {
    showFormMessage('المرجو وضع الإحداثيات', 'error');
    hapticFeedback('error');
    return;
  }

  const checkBounds = geojsonBounds || APPROX_BOUNDS;
  if (!checkBounds.contains([lat, lng])) {
    showFormMessage('الإحداثيات خارج حدود الجزائر', 'error');
    hapticFeedback('error');
    return;
  }

  // Récupérer la Wilaya sélectionnée manuellement via TomSelect
  let selectedWilaya = '';
  const wilayaSelect = document.getElementById('wilaya_select');
  if (wilayaSelect && wilayaSelect.tomselect) {
      const val = wilayaSelect.tomselect.getValue();
      const item = wilayaSelect.tomselect.getItem(val);
      if (item) {
          selectedWilaya = item.textContent.trim(); 
      }
  }

  // Upload l'image vers le serveur pour obtenir une URL
  let photoUrl = null;
  if (photoFile) {
    showFormMessage('جاري رفع الصورة...', 'alert');
    photoUrl = await uploadImageToServer(photoFile);
    if (!photoUrl) {
      showFormMessage('فشل رفع الصورة. حاول مرة أخرى.', 'error');
      return;
    }
  }

  const submissionDate = datePlanted || new Date().toISOString();

  // 🔹 Préparer les données pour le SERVEUR
  const dataToSend = { 
      nom, 
      adresse, 
      type, 
      quantite, 
      lat, 
      lng, 
      date: submissionDate, 
      photo: photoUrl,
      state: selectedWilaya,
      createdAt: new Date().toISOString()
  };

  console.log("📤 Envoi vers le serveur :", dataToSend);
  showFormMessage('جاري الإرسال...', 'alert');

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataToSend)
    });

    const result = await response.json().catch(() => ({}));
    
    if (response.ok && result.success) {
      console.log("✅ Arbre enregistré avec ID :", result.insertedId);
      hapticFeedback('success');
      showFormMessage('✅ تم إضافة الشجرة بنجاح!', 'success');
      
      // Retirer le marqueur temporaire
      if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
      
      // Centrer la carte sur la nouvelle position
      map.setView([lat, lng], 13);
      
      // 🔹 Rafraîchir les données depuis le serveur pour avoir l'entrée avec son vrai ID
      await refreshFromServer();
      
      // Réinitialiser le formulaire
      resetForm();
      validateForm();
      
      // Afficher la liste des contributions
      switchPanel('list-panel');
      
    } else {
      console.error("❌ Erreur serveur :", result.error || 'Réponse invalide');
      showFormMessage('حدث خطأ عند الاتصال بالخادم: ' + (result.error || ''), 'error');
      hapticFeedback('error');
    }
  } catch (err) {
    console.error("❌ Erreur fetch :", err);
    showFormMessage('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت.', 'error');
    hapticFeedback('error');
  }
}

async function loadRemoteSample() {
  const sampleImg = document.getElementById('remoteSamplePhoto');
  const sampleInfo = document.getElementById('remoteSampleInfo');
  if (!sampleImg || !sampleInfo) return;

  try {
    const response = await fetch('https://greenalgeria-backend.onrender.com/api/contributions?limit=1');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const latest = data[0];
      if (latest.photo) {
        sampleImg.src = latest.photo;
        sampleImg.style.display = 'block';
      } else {
        sampleImg.style.display = 'none';
      }
      const contributor = latest.nom || 'مشارك مجهول';
      const treeType = latest.type || 'نوع غير محدد';
      const createdAt = latest.createdAt ? new Date(latest.createdAt).toLocaleString('ar-EG') : '';
      const locality = [latest.city, latest.district].filter(Boolean).join(' — ');
      const locationTag = locality ? ` | ${locality}` : '';
      sampleInfo.textContent = `${contributor} — ${treeType}${locationTag}${createdAt ? ` (${createdAt})` : ''}`;
      sampleInfo.style.display = 'block';
    } else {
      sampleImg.style.display = 'none';
      sampleInfo.textContent = 'لا توجد بيانات لعرضها حالياً.';
      sampleInfo.style.display = 'block';
    }
  } catch (error) {
    console.warn('تعذر تحميل مثال الصورة من الخادم:', error);
    sampleImg.style.display = 'none';
    sampleInfo.textContent = 'تعذر تحميل مثال الصورة من الخادم.';
    sampleInfo.style.display = 'block';
  }
}