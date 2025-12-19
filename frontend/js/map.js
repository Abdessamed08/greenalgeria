/* --------------------------------- */
/* Configuration Globale & Helpers   */
/* --------------------------------- */
const STORAGE_KEY = 'algerie_verte_v3';
// ðŸ”¹ URL de l'API dÃ©ployÃ©e sur Render
const API_URL = 'https://greenalgeria-backend.onrender.com/api/contributions';
const UPLOAD_URL = 'https://greenalgeria-backend.onrender.com/api/upload';

let map, markerCluster, heatLayer;
let entries = [];
let tileDefault, tileToner;
let geojsonBounds = null;
let tempMarker = null;
// Map selection mode removed
let currentFormLat = null;
let currentFormLng = null;
let currentEditLat = null;
let currentEditLng = null;
let watchPositionId = null; // ID pour watchPosition (gÃ©olocalisation mobile)
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

/* Helper: toast avancÃ© */
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

/* RÃ©cupÃ¨re l'icÃ´ne Font Awesome basÃ©e sur le type */
function getTreeIconClass(type) {
  if (!type) return 'fas fa-tree'; // Fallback icon
  type = type.toLowerCase();
  if (type.includes('ØµÙ†ÙˆØ¨Ø±') || type.includes('Ø£Ø±Ø²') || type.includes('conifer')) return 'fas fa-tree';
  if (type.includes('Ù†Ø®ÙŠÙ„') || type.includes('palm')) return 'fas fa-leaf';
  if (type.includes('Ø²ÙŠØªÙˆÙ†') || type.includes('olivier')) return 'fas fa-seedling';
  if (type.includes('Ø¨Ù„ÙˆØ·') || type.includes('chÃªne')) return 'fas fa-tree';
  return 'fas fa-seedling';
}

/* Formate la date */
function formatDate(timestamp) {
  if (!timestamp) return 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯';
  const date = new Date(timestamp);
  const options = { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleDateString('ar-EG', options);
}

/* --------------------------------- */
/* Gestion de la Carte               */
/* --------------------------------- */

function initMap() {
  map = L.map('map', { center: ALGERIA_CENTER, zoom: 5, minZoom: 5, maxZoom: 12, zoomControl: true });

  tileDefault = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: 'Â© OpenStreetMap contributors' }).addTo(map);
  tileToner = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png', { maxZoom: 20, attribution: 'Tiles: Stamen' });

  markerCluster = L.markerClusterGroup({ chunkedLoading: true });
  map.addLayer(markerCluster);

  heatLayer = L.heatLayer([], { radius: 25, blur: 18, maxZoom: 11 });

  // GÃ©rer les clics sur la carte pour dÃ©finir la position (mode sÃ©lection)
  // Click handling removed as per requirement

  // Chargement de la frontiÃ¨re GeoJSON de l'AlgÃ©rie pour les limites
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

  // Attacher le bouton de gÃ©olocalisation (sera aussi fait dans DOMContentLoaded pour sÃ©curitÃ©)
  attachGeolocationButton();

  loadFromStorage();
  validateForm();
}

/**
 * GÃ¨re le marqueur temporaire (pour Ajout et Ã‰dition)
 * @param {L.LatLng} latlng - CoordonnÃ©es de la position
 * @param {boolean} draggable - Si le marqueur peut Ãªtre dÃ©placÃ©
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

  // Force draggable = false pour empÃªcher la modification manuelle de la position GPS
  tempMarker = L.marker(latlng, { icon: tempIcon, draggable: false });

  // Ã‰vÃ©nement dragend supprimÃ© car le marqueur n'est plus dÃ©plaÃ§able
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
 * Ajout du marqueur d'arbre sur la carte (avec Popup Ã©lÃ©gante)
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

  // --- CONTENU DE LA POPUP Ã‰LÃ‰GANTE ---
  const popupContent = `
    <div class="elegant-popup" dir="rtl">
        <h4><i class="${treeIconClass}" style="margin-left:5px; color:var(--color-secondary);"></i> ${escapeHtml(entry.type)}</h4>
        <p>Ø§Ù„Ø¹Ø¯Ø¯: ${entry.quantite} Ø´Ø¬Ø±Ø©</p>
        <button class="popup-btn" onclick="centerAndOpenPanel('${entry.id}')">
            Ø¹Ø±Ø¶ Ø§Ù„ØªÙØ§ØµÙŠÙ„ <i class="fas fa-arrow-left" style="margin-right:5px;"></i>
        </button>
    </div>
  `;
  // ---------------------------------------------

  marker.bindPopup(popupContent, {
    closeButton: false,
    autoClose: true,
    closeOnClick: true,
    // La taille maximale est ajustÃ©e par le CSS min-width: 200px
  });

  // Le clic sur le marqueur Ouvre la popup par dÃ©faut. 
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
 * Centre la carte sur des coordonnÃ©es et ajuste le zoom
 */
function centerOn(lat, lng, zoomLevel = 12) {
  map.setView([lat, lng], zoomLevel);
}

/**
 * Fonction combinÃ©e pour centrer et ouvrir le panneau de dÃ©tail
 * UtilisÃ© par le bouton dans la popup et les actions de la liste.
 */
function centerAndOpenPanel(id) {
  const entry = entries.find(x => x.id === id);
  if (!entry) return;

  centerOn(entry.lat, entry.lng, 15);
  showDetailPanel(id);
}

/**
 * Trouve l'entrÃ©e et l'affiche dans le panneau de dÃ©tail
 */
function showDetailPanel(id) {
  const entry = entries.find(x => x.id === id);
  if (!entry) { toast('Ø®Ø·Ø£: Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø§Ù„Ù…Ø³Ø§Ù‡Ù…Ø©', 'error'); return; }

  const typeIcon = getTreeIconClass(entry.type);

  // Mise Ã  jour des boutons d'action
  document.getElementById('detailEditBtn').dataset.id = entry.id;
  document.getElementById('detailDeleteBtn').dataset.id = entry.id;

  // Mise Ã  jour du contenu
  document.getElementById('detail-title').innerHTML = `<i class="${typeIcon}" style="margin-left:5px; color:var(--color-secondary);"></i> ${escapeHtml(entry.type)}`;

  // Correction URL image avec nettoyage et placeholder
  let photoUrl = entry.photo;
  if (photoUrl) {
    // Cas image locale mal formÃ©e (gumlet + localhost)
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

  document.getElementById('detail-type').textContent = `${escapeHtml(entry.type)} ${entry.updatedAt ? '(Ù…Ø¹Ø¯Ù‘Ù„)' : ''}`;
  document.getElementById('detail-quantite').textContent = `${entry.quantite} Ø´Ø¬Ø±Ø©`;
  document.getElementById('detail-nom').textContent = escapeHtml(entry.nom);
  document.getElementById('detail-adresse').textContent = escapeHtml(entry.adresse || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯');
  document.getElementById('detail-city').textContent = escapeHtml(entry.city || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯');
  document.getElementById('detail-district').textContent = escapeHtml(entry.district || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯');
  document.getElementById('detail-date').textContent = entry.date ? entry.date.replace(/-/g, '/') : 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯';
  document.getElementById('detail-createdAt').textContent = formatDate(entry.createdAt);
  // Coords display removed

  // Pour l'action "TÃ©lÃ©copie"
  document.getElementById('detail-lat').value = entry.lat;
  document.getElementById('detail-lng').value = entry.lng;

  // Afficher le panneau de dÃ©tail (et changer l'onglet sur mobile)
  switchPanel('detail-panel');
  toggleSidebar(true, 'detail-panel'); // Ouvre la barre latÃ©rale sur le dÃ©tail si mobile

  // Fermer toutes les popups
  map.closePopup();

  // Assurer que le marqueur est visible et ouvrir sa *quickPopup* (optionnel)
  let found = null;
  markerCluster.eachLayer(l => { if (l._entryId === id) found = l; });
  if (found) found.openPopup();
}

/**
 * Fonction combinÃ©e pour centrer et ouvrir la popup (utilisÃ©e par la liste)
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
/* Gestion des DonnÃ©es (CRUD)        */
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

    // Limiter la taille Ã  2MB pour Ã©viter les problÃ¨mes de localStorage
    const maxSize = 2 * 1024 * 1024; // 2MB
    if (file.size > maxSize) {
      showFormMessage('Ø­Ø¬Ù… Ø§Ù„ØµÙˆØ±Ø© ÙƒØ¨ÙŠØ± Ø¬Ø¯Ø§Ù‹. Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ù‚ØµÙ‰ 2MB', 'error');
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

  // Limiter la taille Ã  5MB pour l'upload serveur
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    showFormMessage('Ø­Ø¬Ù… Ø§Ù„ØµÙˆØ±Ø© ÙƒØ¨ÙŠØ± Ø¬Ø¯Ø§Ù‹. Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ù‚ØµÙ‰ 5MB', 'error');
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

    // L'URL retournÃ©e est maintenant soit Cloudinary (permanent), soit locale (fallback)
    // On ne passe plus par Gumlet car Cloudinary gÃ¨re dÃ©jÃ  l'optimisation
    const finalUrl = result.url;

    console.log('âœ… Image uploadÃ©e:', finalUrl);
    return finalUrl;
  } catch (error) {
    console.error('âŒ Erreur upload image:', error);
    showFormMessage('Ø®Ø·Ø£ ÙÙŠ Ø±ÙØ¹ Ø§Ù„ØµÙˆØ±Ø© Ø¥Ù„Ù‰ Ø§Ù„Ø®Ø§Ø¯Ù…', 'error');
    return null;
  }
}

/**
 * Gestion de l'ajout (CrÃ©ation)
 */
// handleSubmit() est dÃ©finie plus bas dans le fichier avec l'envoi au serveur

/**
 * Gestion de la modification (Update)
 */
async function handleEditSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  let entry = entries.find(x => x.id === id);

  if (!entry) { toast('Ø®Ø·Ø£: Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø§Ù„Ù…Ø³Ø§Ù‡Ù…Ø©', 'error'); return; }

  const newLat = currentEditLat !== null ? currentEditLat : entry.lat;
  const newLng = currentEditLng !== null ? currentEditLng : entry.lng;
  const newQuantite = parseInt(document.getElementById('editQuantite').value);

  // GÃ©rer la photo si un nouveau fichier est sÃ©lectionnÃ©
  const editPhotoInput = document.getElementById('editPhoto');
  if (editPhotoInput && editPhotoInput.files && editPhotoInput.files[0]) {
    try {
      const photoBase64 = await convertImageToBase64(editPhotoInput.files[0]);
      if (photoBase64) {
        entry.photo = photoBase64;
      }
    } catch (error) {
      console.error('Erreur lors de la conversion de la photo:', error);
    }
  }

  // Mettre Ã  jour les propriÃ©tÃ©s
  entry.nom = document.getElementById('editNom').value.trim();
  entry.adresse = document.getElementById('editAdresse').value.trim();
  entry.type = document.getElementById('editTypeArbre').value;
  entry.quantite = newQuantite;
  entry.date = document.getElementById('editDatePlanted').value || null;
  entry.lat = newLat;
  entry.lng = newLng;
  entry.updatedAt = Date.now(); // Marque la modification

  // Mise Ã  jour de la carte (retirer l'ancien marqueur, ajouter le nouveau)
  let markerToRemove = null;
  markerCluster.eachLayer(l => { if (l._entryId === id) markerToRemove = l; });
  if (markerToRemove) markerCluster.removeLayer(markerToRemove);

  // RÃ©injecter le marqueur mis Ã  jour
  addEntryToMap(entry);
  centerOn(entry.lat, entry.lng);

  saveToStorage();
  applyFiltersAndSort();
  closeModal();
  showDetailPanel(id); // Afficher la fiche de dÃ©tail mise Ã  jour
  toast('âœ… ØªÙ… ØªØ­Ø¯ÙŠØ« Ø§Ù„Ù…Ø³Ø§Ù‡Ù…Ø© Ø¨Ù†Ø¬Ø§Ø­.', 'success');
}


/**
 * Gestion de la suppression (Delete)
 */
function removeEntry(id) {
  if (!confirm('Ù‡Ù„ ØªØ±ÙŠØ¯ Ø­Ø°Ù Ù‡Ø°Ù‡ Ø§Ù„Ø¥Ø¶Ø§ÙØ© Ø¨Ø´ÙƒÙ„ Ù†Ù‡Ø§Ø¦ÙŠØŸ')) return;
  entries = entries.filter(e => e.id !== id);
  saveToStorage();
  let toRemove = null;
  markerCluster.eachLayer(l => { if (l._entryId === id) toRemove = l; });
  if (toRemove) markerCluster.removeLayer(toRemove);
  applyFiltersAndSort();
  toast('ØªÙ… Ø­Ø°Ù Ø§Ù„Ù…Ø³Ø§Ù‡Ù…Ø©.', 'error');
  // Revenir Ã  la liste aprÃ¨s suppression
  switchPanel('list-panel');
}



/* --------------------------------- */
/* Modal d'Ã©dition et Formulaires    */
/* --------------------------------- */
function openEditModal(id) {
  const entry = entries.find(x => x.id === id);
  if (!entry) { toast('Ø®Ø·Ø£: Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø§Ù„Ø¹Ù†ØµØ±', 'error'); return; }

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

  // RÃ©initialiser le champ de fichier
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
// ... (validateForm, validateEditForm, showFormMessage, resetForm, handleGeolocation restent inchangÃ©es)

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

  // RÃ©initialiser les classes
  el.className = '';
  el.classList.add(type);

  // IcÃ´ne selon le type
  const icon = type === 'success' ? '<i class="fas fa-check-circle"></i>' :
    type === 'error' ? '<i class="fas fa-exclamation-circle"></i>' :
      '<i class="fas fa-info-circle"></i>';

  el.innerHTML = icon + ' <span>' + text + '</span>';
  el.style.display = 'flex';
  el.style.opacity = '1';

  // Scroll vers le message si nÃ©cessaire
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);

  // Masquer aprÃ¨s 5 secondes avec fade out
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
  // ArrÃªter la gÃ©olocalisation en cours si active
  if (watchPositionId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
  validateForm();
}

/**
 * Active/dÃ©sactive le mode "sÃ©lection sur la carte"
 */
// toggleMapSelectionMode removed entirely

/**
 * Attache les event listeners au bouton de gÃ©olocalisation
 * Cette fonction peut Ãªtre appelÃ©e plusieurs fois en sÃ©curitÃ©
 */
function attachGeolocationButton() {
  // Utiliser plusieurs sÃ©lecteurs pour Ãªtre sÃ»r de trouver le bouton
  const geolocBtn = document.getElementById('geolocationBtn') ||
    document.querySelector('button[aria-label*="ØªØ­Ø¯ÙŠØ¯ Ù…ÙˆÙ‚Ø¹ÙŠ"]') ||
    document.querySelector('button[onclick*="handleGeolocation"]') ||
    document.querySelector('.form-button-group .btn.primary');

  if (!geolocBtn) {
    console.warn('Bouton de gÃ©olocalisation non trouvÃ© lors de l\'attachement');
    return;
  }

  if (geolocBtn.hasAttribute('data-geoloc-attached')) {
    console.log('Bouton dÃ©jÃ  attachÃ©');
    return;
  }

  // Marquer comme attachÃ© pour Ã©viter les doubles
  geolocBtn.setAttribute('data-geoloc-attached', 'true');

  // Retirer l'onclick si prÃ©sent
  geolocBtn.removeAttribute('onclick');

  // Fonction pour gÃ©rer le clic - IMPORTANT: doit Ãªtre appelÃ©e directement depuis un Ã©vÃ©nement utilisateur
  const handleGeolocClick = function (e) {
    console.log('Clic sur le bouton de gÃ©olocalisation dÃ©tectÃ©');
    e.preventDefault();
    e.stopPropagation();
    // Appeler directement dans le contexte de l'Ã©vÃ©nement utilisateur
    handleGeolocation();
  };

  // Ajouter plusieurs listeners pour meilleure compatibilitÃ© mobile
  // Utiliser 'click' qui fonctionne aussi pour les Ã©vÃ©nements tactiles
  geolocBtn.addEventListener('click', handleGeolocClick, { passive: false, capture: false });

  // Ajouter aussi touchstart pour mobile (mais ne pas preventDefault pour permettre le click)
  geolocBtn.addEventListener('touchstart', function (e) {
    console.log('Touchstart dÃ©tectÃ© sur le bouton');
    // Ne pas preventDefault pour permettre le click de se dÃ©clencher aussi
  }, { passive: true });

  // S'assurer que le bouton est cliquable
  geolocBtn.style.cursor = 'pointer';
  geolocBtn.style.touchAction = 'manipulation';
  geolocBtn.style.webkitTapHighlightColor = 'transparent';
  geolocBtn.style.userSelect = 'none';
  geolocBtn.style.webkitUserSelect = 'none';

  console.log('Bouton de gÃ©olocalisation attachÃ© avec succÃ¨s:', geolocBtn);

  // Select on map button handling removed
}

function handleGeolocation() {
  console.log('handleGeolocation appelÃ©');

  // ArrÃªter tout watchPosition en cours
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }

  // Selection mode handling removed

  // VÃ©rifier le support de la gÃ©olocalisation
  if (!navigator.geolocation) {
    const errorMsg = 'Ø§Ù„Ù…ØªØµÙØ­ Ù„Ø§ ÙŠØ¯Ø¹Ù… Ø§Ù„Ù…ÙˆÙ‚Ø¹. ÙŠØ¬Ø¨ Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø¬Ù‡Ø§Ø² ÙŠØ¯Ø¹Ù… GPS.';
    console.error('Geolocation non supportÃ©');
    showFormMessage(errorMsg, 'error');
    hapticFeedback('error');
    return;
  }

  // VÃ©rifier si on est en HTTPS ou localhost (requis pour la gÃ©olocalisation)
  const isSecure = window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0';

  if (!isSecure) {
    const insecureMsg = 'âš ï¸ ÙŠØªØ·Ù„Ø¨ Ø§Ù„Ù…ÙˆÙ‚Ø¹ HTTPS Ù„Ù„Ø¹Ù…Ù„ Ø¹Ù„Ù‰ Ø§Ù„Ù‡Ø§ØªÙ. ÙŠØ±Ø¬Ù‰ Ø§Ø³ØªØ®Ø¯Ø§Ù… HTTPS.';
    console.warn('GÃ©olocalisation nÃ©cessite HTTPS (sauf localhost)');
    showFormMessage(insecureMsg, 'error');
    return;
    return;
  }

  // Trouver le bouton de maniÃ¨re plus robuste (plusieurs sÃ©lecteurs pour mobile)
  const btn = document.querySelector('button[aria-label*="ØªØ­Ø¯ÙŠØ¯ Ù…ÙˆÙ‚Ø¹ÙŠ"]') ||
    document.querySelector('button[onclick*="handleGeolocation"]') ||
    document.querySelector('.form-button-group .btn.primary') ||
    document.querySelector('.form-button-group button:first-child');

  if (!btn) {
    console.error('Bouton de gÃ©olocalisation non trouvÃ©');
    showFormMessage('Ø®Ø·Ø£ ÙÙŠ Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø§Ù„Ø²Ø±', 'error');
    return;
  }

  console.log('Bouton trouvÃ©:', btn);

  const originalHtml = btn.innerHTML;
  const originalDisabled = btn.disabled;

  // Feedback visuel immÃ©diat
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ø¬Ø§Ø±ÙŠ Ø§Ù„Ø¨Ø­Ø«...';
  btn.disabled = true;
  hapticFeedback('light');

  // DÃ©tection mobile amÃ©liorÃ©e
  const isMobile = window.matchMedia('(max-width: 1024px)').matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    ('ontouchstart' in window);

  console.log('Mobile dÃ©tectÃ©:', isMobile);
  console.log('User Agent:', navigator.userAgent);
  console.log('Protocol:', window.location.protocol);
  console.log('Hostname:', window.location.hostname);

  // Message informatif avec instructions pour mobile
  const helpMsg = isMobile
    ? 'Ø¬Ø§Ø±ÙŠ ØªØ­Ø¯ÙŠØ¯ Ù…ÙˆÙ‚Ø¹Ùƒ... ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø³Ù…Ø§Ø­ Ø¨Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ø§Ù„Ù…ÙˆÙ‚Ø¹ ÙÙŠ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù…ØªØµÙØ­ ÙˆØªØ£ÙƒØ¯ Ù…Ù† ØªÙØ¹ÙŠÙ„ GPS.'
    : 'Ø¬Ø§Ø±ÙŠ ØªØ­Ø¯ÙŠØ¯ Ù…ÙˆÙ‚Ø¹Ùƒ... ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø³Ù…Ø§Ø­ Ø¨Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ø§Ù„Ù…ÙˆÙ‚Ø¹.';
  showFormMessage(helpMsg, 'alert');

  // Options optimisÃ©es pour mobile - ACTIVER GPS avec enableHighAccuracy: true
  const options = {
    enableHighAccuracy: true,  // IMPORTANT: Activer pour utiliser le GPS rÃ©el sur mobile
    timeout: isMobile ? 60000 : 25000,  // 60 secondes sur mobile (plus de temps pour GPS), 25 sur desktop
    maximumAge: isMobile ? 0 : 30000  // 0 sur mobile (toujours obtenir une nouvelle position), 30 secondes sur desktop
  };

  console.log('Options de gÃ©olocalisation:', options);

  // Fonction pour traiter la position avec succÃ¨s
  const handleSuccess = function (pos) {
    console.log('Position obtenue avec succÃ¨s:', pos.coords);
    console.log('PrÃ©cision:', pos.coords.accuracy, 'mÃ¨tres');
    console.log('Source:', pos.coords.altitude !== null ? 'GPS' : 'RÃ©seau');

    const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);

    // VÃ©rifier que les coordonnÃ©es sont valides
    if (isNaN(latlng.lat) || isNaN(latlng.lng)) {
      console.error('CoordonnÃ©es invalides:', latlng);
      showFormMessage('Ø®Ø·Ø£: Ø¥Ø­Ø¯Ø§Ø«ÙŠØ§Øª ØºÙŠØ± ØµØ­ÙŠØ­Ø©', 'error');
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
      hapticFeedback('error');
      return;
    }

    // VÃ©rifier que les coordonnÃ©es sont dans les limites de l'AlgÃ©rie
    // Utiliser geojsonBounds si disponible, sinon APPROX_BOUNDS
    const checkBounds = geojsonBounds || APPROX_BOUNDS;
    if (checkBounds && !checkBounds.contains([latlng.lat, latlng.lng])) {
      console.warn('Position hors limites:', latlng);
      showFormMessage('Ù…ÙˆÙ‚Ø¹Ùƒ Ø®Ø§Ø±Ø¬ Ø­Ø¯ÙˆØ¯ Ø§Ù„Ø¬Ø²Ø§Ø¦Ø±. ÙŠØ±Ø¬Ù‰ Ø§Ù„ØªØ£ÙƒØ¯ Ù…Ù† Ø§Ù„Ù…ÙˆÙ‚Ø¹.', 'error');
      btn.innerHTML = originalHtml;
      btn.disabled = originalDisabled;
      hapticFeedback('error');
      return;
    }

    // ArrÃªter watchPosition si actif
    if (watchPositionId !== null) {
      navigator.geolocation.clearWatch(watchPositionId);
      watchPositionId = null;
    }

    // Mettre Ã  jour les champs
    // Update internal variables
    currentFormLat = latlng.lat;
    currentFormLng = latlng.lng;

    // Debug log
    console.log('Location updated:', currentFormLat, currentFormLng);

    // Calculer le niveau de zoom optimal selon la prÃ©cision GPS
    // Plus la prÃ©cision est bonne, plus on zoome
    const accuracy = pos.coords.accuracy;
    let zoomLevel;
    if (accuracy < 50) {
      zoomLevel = 17; // TrÃ¨s haute prÃ©cision (GPS actif)
    } else if (accuracy < 100) {
      zoomLevel = 16; // Haute prÃ©cision
    } else if (accuracy < 500) {
      zoomLevel = 14; // PrÃ©cision moyenne
    } else {
      zoomLevel = 12; // PrÃ©cision faible (rÃ©seau)
    }

    // Placer le marqueur temporaire ET centrer la carte avec le bon zoom
    setTempMarker(latlng, true, zoomLevel);

    // Mettre Ã  jour le statut visuel
    const statusEl = document.getElementById('locationStatus');
    if (statusEl) {
      statusEl.innerHTML = `
            <div class="status-success">
                <i class="fas fa-check-circle"></i>
                <span>ØªÙ… ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ù…ÙˆÙ‚Ø¹ Ø¨Ø¯Ù‚Ø© (${Math.round(accuracy)}m)</span>
            </div>
        `;
    }

    // Tenter de rÃ©cupÃ©rer l'adresse automatiquement (Reverse Geocoding Client)
    // C'est juste pour aider l'utilisateur, le serveur fera le vrai geocoding
    fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latlng.lat}&lon=${latlng.lng}&accept-language=ar`)
      .then(res => res.json())
      .then(data => {
        const address = data.address || {};
        const city = address.city || address.town || address.village || address.municipality;
        const district = address.suburb || address.neighbourhood || address.city_district;

        let displayAddress = '';
        if (city) displayAddress += city;
        if (district) displayAddress += (displayAddress ? 'ØŒ ' : '') + district;

        if (displayAddress) {
          const addrInput = document.getElementById('adresse');
          if (addrInput && !addrInput.value) {
            addrInput.value = displayAddress;
            // Petit effet visuel pour montrer que Ã§a a Ã©tÃ© rempli
            addrInput.style.backgroundColor = '#ecfdf5';
            setTimeout(() => addrInput.style.backgroundColor = '', 1500);
            toast(`ØªÙ… ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ø¹Ù†ÙˆØ§Ù†: ${displayAddress}`);
          }
        }
      })
      .catch(err => console.warn('Geocoding client failed:', err));

    // Feedback de succÃ¨s avec info sur la prÃ©cision
    const accuracyMsg = pos.coords.accuracy < 50
      ? 'âœ… ØªÙ… ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ù…ÙˆÙ‚Ø¹ Ø¨Ø¯Ù‚Ø© Ø¹Ø§Ù„ÙŠØ©!'
      : 'âœ… ØªÙ… ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ù…ÙˆÙ‚Ø¹ Ø¨Ù†Ø¬Ø§Ø­!';
    showFormMessage(accuracyMsg, 'success');
    hapticFeedback('success');

    // Restaurer le bouton
    btn.innerHTML = originalHtml;
    btn.disabled = originalDisabled;

    // Valider le formulaire
    validateForm();
  };

  // Fonction pour gÃ©rer les erreurs
  const handleError = function (err) {
    console.error('Erreur de gÃ©olocalisation:', err);
    let errMsg = 'ÙØ´Ù„ ÙÙŠ Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ Ø§Ù„Ù…ÙˆÙ‚Ø¹.';
    let showRetry = false;

    switch (err.code) {
      case 1: // PERMISSION_DENIED
        errMsg = 'ØªÙ… Ø±ÙØ¶ Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ø§Ù„Ù…ÙˆÙ‚Ø¹. ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø³Ù…Ø§Ø­ Ø¨Ø§Ù„ÙˆØµÙˆÙ„ ÙÙŠ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù…ØªØµÙØ­ Ø«Ù… Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.';
        console.error('Permission refusÃ©e');
        showRetry = true;
        break;
      case 2: // POSITION_UNAVAILABLE
        errMsg = 'Ø§Ù„Ù…ÙˆÙ‚Ø¹ ØºÙŠØ± Ù…ØªÙˆÙØ±. ÙŠØ±Ø¬Ù‰ ØªÙØ¹ÙŠÙ„ GPS ÙÙŠ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù‡Ø§ØªÙ Ø«Ù… Ø§Ù„Ù†Ù‚Ø± Ø¹Ù„Ù‰ "ØªØ­Ø¯ÙŠØ¯ Ù…ÙˆÙ‚Ø¹ÙŠ" Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.';
        console.error('Position non disponible (GPS probablement Ã©teint)');
        showRetry = true;

        // Sur mobile, on rÃ©essaie quand mÃªme une fois avec watchPosition au cas oÃ¹
        if (isMobile) {
          console.log('Tentative avec watchPosition comme fallback...');

          // Si c'est la premiÃ¨re tentative de fallback, on essaie silencieusement
          if (watchPositionId === null) {
            showFormMessage('Ø¬Ø§Ø±ÙŠ ØªÙØ¹ÙŠÙ„ GPS... (Ù‚Ø¯ ÙŠØ³ØªØºØ±Ù‚ Ø¯Ù‚ÙŠÙ‚Ø©)', 'alert');

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

                // Si Ã©chec total du GPS, tenter une derniÃ¨re fois en mode "basse prÃ©cision" (Wifi/RÃ©seau)
                if (watchErr.code === 3 || watchErr.code === 2) {
                  console.log('Echec GPS, tentative basse prÃ©cision...');
                  navigator.geolocation.getCurrentPosition(
                    handleSuccess,
                    function (finalErr) {
                      // Echec final
                      let finalMsg = 'ÙØ´Ù„ ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ù…ÙˆÙ‚Ø¹ Ø¨Ø¯Ù‚Ø©. ÙŠØ±Ø¬Ù‰ ØªÙØ¹ÙŠÙ„ GPS ÙˆØ§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.';
                      if (finalErr.code === 1) finalMsg = 'ØªÙ… Ø±ÙØ¶ Ø§Ù„Ø¥Ø°Ù†. ÙŠØ±Ø¬Ù‰ ØªÙØ¹ÙŠÙ„ Ø§Ù„Ù…ÙˆÙ‚Ø¹ Ù„Ù„Ù…ØªØµÙØ­.';

                      showFormMessage(finalMsg, 'error');

                      btn.innerHTML = '<i class="fas fa-redo"></i> Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©';
                      btn.onclick = function () { handleGeolocation(); };
                      btn.disabled = false;
                    },
                    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
                  );
                  return;
                }

                showFormMessage('ÙØ´Ù„ ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ù…ÙˆÙ‚Ø¹. ÙŠØ±Ø¬Ù‰ ØªÙØ¹ÙŠÙ„ GPS.', 'error');
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
        errMsg = 'Ø§Ù†ØªÙ‡Øª Ø§Ù„Ù…Ù‡Ù„Ø©. ØªØ£ÙƒØ¯ Ù…Ù† ØªÙØ¹ÙŠÙ„ GPS ÙˆØ­Ø§ÙˆÙ„ Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.';
        console.error('Timeout');
        showRetry = true;

        // Sur mobile, essayer avec watchPosition comme fallback
        if (isMobile) {
          console.log('Timeout - Tentative avec watchPosition...');
          showFormMessage('ØªØ£ÙƒØ¯ Ù…Ù† ØªÙØ¹ÙŠÙ„ GPS... Ø¬Ø§Ø±ÙŠ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©...', 'alert');
          watchPositionId = navigator.geolocation.watchPosition(
            handleSuccess,
            function (watchErr) {
              console.error('Erreur watchPosition aprÃ¨s timeout:', watchErr);
              showFormMessage('ØªØ¹Ø°Ø± ØªØ­Ø¯ÙŠØ¯ Ø§Ù„Ù…ÙˆÙ‚Ø¹. ÙŠØ±Ø¬Ù‰ Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† GPS ÙˆØ§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø¬Ø¯Ø¯Ø§Ù‹.', 'error');
              hapticFeedback('error');
              btn.innerHTML = '<i class="fas fa-redo"></i> Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø¬Ø¯Ø¯Ø§Ù‹';
              btn.disabled = false;
              // RÃ©attacher l'Ã©vÃ©nement click standard si besoin, ou laisser le bouton actif
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
        errMsg = `Ø®Ø·Ø£ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ (${err.code}). ÙŠØ±Ø¬Ù‰ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.`;
        console.error('Erreur inconnue:', err);
        showRetry = true;
    }

    showFormMessage(errMsg, 'error');
    hapticFeedback('error');

    if (showRetry) {
      // Proposer de rÃ©essayer au lieu de restaurer simplement
      btn.innerHTML = '<i class="fas fa-redo"></i> ØªÙØ¹ÙŠÙ„ GPS ÙˆØ§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©';
      btn.disabled = false;
      // On s'assure que le clic relance la gÃ©olocalisation
      btn.onclick = function (e) {
        e.preventDefault();
        handleGeolocation();
      };
    } else {
      // En cas d'erreur irrÃ©cupÃ©rable, on force le message d'erreur strict
      showFormMessage('âŒ Ø¹Ø°Ø±Ø§Ù‹ØŒ Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥Ø¶Ø§ÙØ© Ø´Ø¬Ø±Ø© Ø¨Ø¯ÙˆÙ† ØªØ­Ø¯ÙŠØ¯ Ù…ÙˆÙ‚Ø¹ GPS Ø¯Ù‚ÙŠÙ‚. ÙŠØ±Ø¬Ù‰ ØªÙØ¹ÙŠÙ„ Ø§Ù„Ù…ÙˆÙ‚Ø¹.', 'error');
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

/* Fonction toggleMapSelectionMode supprimÃ©e car le mode manuel est dÃ©sactivÃ© */
// Duplicate function removed


/* --------------------------------- */
/* Gestion du Stockage & Statistiques*/
/* --------------------------------- */
function saveToStorage() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch (e) { console.error(e); toast('ÙØ´Ù„ ÙÙŠ Ø§Ù„Ø­ÙØ¸ Ø§Ù„Ù…Ø­Ù„ÙŠ', 'error'); }
}

function loadFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { entries = JSON.parse(raw); } catch (e) { console.warn('parse error', e); entries = []; }
  } else { entries = []; }
  entries = entries.map(e => ({ ...e, quantite: parseInt(e.quantite) || 1 }));
  markerCluster.clearLayers();
  entries.forEach(e => addEntryToMap(e));
  applyFiltersAndSort();
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
  if (filterEl) filterEl.textContent = (filteredCount < safeEntries.length) ? `(${filteredCount} Ù†ØªÙŠØ¬Ø© Ù…Ù† ${safeEntries.length})` : `Ø§Ù„ÙƒÙ„ (${safeEntries.length})`;

  const resultsEl = document.getElementById('resultsCount');
  if (resultsEl) resultsEl.textContent = filteredCount;
}

/* --------------------------------- */
/* Filtres et Affichage de Liste     */
/* --------------------------------- */

function applyFiltersAndSort() {
  let filtered = [...entries];
  const quickSearchEl = document.getElementById('quickSearch');
  const typeFilterEl = document.getElementById('typeFilter');
  const sortOrderEl = document.getElementById('sortOrder');
  const query = (quickSearchEl ? quickSearchEl.value || '' : '').toLowerCase().trim();
  const typeFilter = typeFilterEl ? typeFilterEl.value : '';
  const sortOrder = sortOrderEl ? sortOrderEl.value : 'createdAt';

  if (query) {
    filtered = filtered.filter(e => (
      (e.nom || '') + ' ' + (e.adresse || '') + ' ' + (e.type || '')
    ).toLowerCase().includes(query));
  }
  if (typeFilter) {
    filtered = filtered.filter(e => e.type === typeFilter);
  }

  filtered.sort((a, b) => {
    if (sortOrder === 'nom') return (a.nom || '').localeCompare(b.nom || '');
    if (sortOrder === 'type') return (a.type || '').localeCompare(b.type || '');
    // Handle potential missing createdAt with timestamp fallback or 0
    const timeA = a.createdAt || a.timestamp || 0;
    const timeB = b.createdAt || b.timestamp || 0;
    return timeB - timeA;
  });

  updateList(filtered);
  updateMapMarkers(filtered.map(e => e.id));
  updateStats(filtered.length);
}

/**
 * Met Ã  jour la liste latÃ©rale (Le clic ouvre le panneau de dÃ©tail)
 */
function updateList(filteredEntries) {
  const container = document.getElementById('locationsList');
  if (!container) return;
  container.innerHTML = '';

  // Safe handling of null/undefined
  if (!filteredEntries || !Array.isArray(filteredEntries)) {
    filteredEntries = [];
  }

  const items = filteredEntries.slice(0, 50);

  if (items.length === 0) { container.innerHTML = '<div class="muted text-center p-1" style="text-align:center;">Ù„Ø§ ØªÙˆØ¬Ø¯ Ù†ØªØ§Ø¦Ø¬ Ù…Ø·Ø§Ø¨Ù‚Ø©</div>'; return; }

  items.forEach(e => {
    const div = document.createElement('div');
    div.className = 'location-item';
    div.setAttribute('data-id', e.id);
    div.setAttribute('role', 'listitem');
    div.setAttribute('tabindex', '0');

    // Le clic sur l'Ã©lÃ©ment (pas sur les boutons d'action) ouvre la fiche de dÃ©tail
    div.onclick = (event) => {
      if (!event.target.closest('.location-actions button')) {
        centerAndOpenPanel(e.id); // Centrer sur la contribution et ouvrir le dÃ©tail
      }
    };
    div.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        centerAndOpenPanel(e.id);
      }
    };


    // Nettoyage de l'URL photo si nÃ©cessaire (cas gumlet + localhost)
    let photoUrl = e.photo;
    if (photoUrl && photoUrl.includes('http://localhost') && photoUrl.includes('https://')) {
      // Garder seulement la partie localhost pour dev ou corriger si c'Ã©tait une erreur
      // Ici on suppose que l'image est cassÃ©e si elle pointe vers localhost depuis la prod
      // On tente de la rÃ©cupÃ©rer si elle est accessible, sinon placeholder
      if (window.location.hostname !== 'localhost') {
        // Essayer de corriger l'URL si elle vient de notre backend actuel
        const filename = photoUrl.split('/').pop();
        if (filename && !filename.includes('http')) {
          photoUrl = `${API_URL.replace('/api/contributions', '')}/uploads/${filename}`;
        } else {
          photoUrl = null; // Image irrÃ©cupÃ©rable
        }
      }
    }

    const img = document.createElement('img');
    img.src = photoUrl ? photoUrl + '?w=300' : 'https://via.placeholder.com/400x240?text=No+Image';
    img.onerror = () => { img.src = 'https://via.placeholder.com/400x240?text=Image+Error'; };

    const typeIcon = getTreeIconClass(e.type);

    const meta = document.createElement('div'); meta.className = 'meta';
    const locationInfo = [e.city, e.district].filter(Boolean).join(' â€” ') || 'ØºÙŠØ± Ù…ØªÙˆÙØ±';
    meta.innerHTML = `
      <h4>
        <i class="${typeIcon} type-icon"></i> ${escapeHtml(e.type)} (${e.quantite} Ø´Ø¬Ø±Ø©)
      </h4>
      <p>${escapeHtml(e.nom)} â€” ${escapeHtml(e.adresse || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯')}</p>
      <small class="muted">Ø§Ù„Ù…ÙˆÙ‚Ø¹: ${escapeHtml(locationInfo)}</small>
      <small class="muted">Ø£ÙØ¶ÙŠÙ ÙÙŠ: ${formatDate(e.createdAt || e.timestamp)}</small>
    `;

    const actions = document.createElement('div'); actions.className = 'location-actions';
    actions.innerHTML = `
      <button class="btn icon-only primary" title="Ø¹Ø±Ø¶ Ø§Ù„Ø¨Ø·Ø§Ù‚Ø©" onclick="centerAndOpenPopup('${e.id}')" aria-label="Ø¹Ø±Ø¶ Ø¨Ø·Ø§Ù‚Ø© ${escapeHtml(e.type)}">
          <i class="fas fa-map-marker-alt"></i>
      </button>
      <button class="btn icon-only primary" title="Ø¹Ø±Ø¶ Ø§Ù„ØªÙØ§ØµÙŠÙ„" onclick="centerAndOpenPanel('${e.id}')" aria-label="Ø¹Ø±Ø¶ ØªÙØ§ØµÙŠÙ„ ${escapeHtml(e.type)}">
          <i class="fas fa-eye"></i>
      </button>
      <!-- Suppression dÃ©sactivÃ©e sur la vue publique -->
    `;

    div.appendChild(img);
    div.appendChild(meta);
    div.appendChild(actions);
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

  // DEBUG: VÃ©rifier quel panneau est demandÃ©
  if (isMobile && visible) {
    console.log('toggleSidebar MOBILE - panneau demandÃ©:', initialPanel);
  }

  // Sur desktop, on change juste le panneau sans toggle la visibilitÃ©
  if (!isMobile) {
    if (visible && initialPanel) {
      switchPanel(initialPanel);
    }
    return;
  }

  if (visible) {
    sidebar.classList.add('visible');
    // Mobile UX: ne montrer que l'onglet actif dans la barre mobile
    if (mobileNav) mobileNav.classList.add('single-only');
    // Trouver l'onglet correspondant pour garantir le bon "active" - FORCER le changement
    const clickedNavItem = document.querySelector(`.mobile-nav-item[data-target="${initialPanel}"]`);
    // S'assurer que tous les onglets sont dÃ©sactivÃ©s d'abord
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
    // document.body.style.overflow = 'hidden'; // CommentÃ© pour permettre le scroll de la carte
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
    sidebar.classList.remove('visible');
    document.body.style.overflow = '';
    // RÃ©tablir l'affichage de tous les onglets quand on ferme la sidebar
    if (mobileNav) mobileNav.classList.remove('single-only');
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

  // Gestion du swipe vers la gauche pour fermer (panneau latÃ©ral)
  sidebar.addEventListener('touchstart', function (e) {
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    isSwiping = false;
  }, { passive: true });

  sidebar.addEventListener('touchmove', function (e) {
    if (!touchStartX) return;

    const touchY = e.touches[0].clientY;
    const touchX = e.touches[0].clientX;
    const deltaX = touchStartX - touchX; // NÃ©gatif = swipe vers la gauche
    const deltaY = Math.abs(touchY - touchStartY);

    // DÃ©tecter un swipe vers la gauche (plus de mouvement horizontal que vertical)
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
      toggleSidebar(false);
    } else {
      // RÃ©initialiser la transformation
      sidebar.style.transform = '';
    }

    touchStartX = 0;
    touchStartY = 0;
    isSwiping = false;
  }, { passive: true });

  // Fermer la sidebar en cliquant sur l'overlay (zone sombre)
  const mapwrap = document.querySelector('.mapwrap');
  if (mapwrap) {
    // Utiliser la dÃ©lÃ©gation d'Ã©vÃ©nements pour l'overlay
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
  const isDetailPanel = targetId === 'detail-panel';

  // DEBUG: VÃ©rifier quel panneau est appelÃ©
  console.log('switchPanel appelÃ© avec:', targetId);

  // Haptic feedback sur mobile
  hapticFeedback('light');

  // 1. GÃ©rer l'affichage du panneau (Simple et robuste)
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

  // 2. GÃ©rer la navigation mobile
  navItems.forEach(item => {
    item.classList.remove('active');
    item.setAttribute('aria-selected', 'false');
  });

  if (isDetailPanel) {
    // Le panneau DÃ©tail est un onglet "spÃ©cial" qui apparaÃ®t temporairement
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


  // 3. Assurer la mise Ã  jour des donnÃ©es lors du changement vers l'onglet List/Stats
  if (targetId === 'list-panel' || targetId === 'stats-panel') {
    try {
      applyFiltersAndSort();
    } catch (err) {
      console.error('Error updating list/stats:', err);
      toast('Ø­Ø¯Ø« Ø®Ø·Ø£ ÙÙŠ Ø¹Ø±Ø¶ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª', 'error');
    }
  }
}

// Preview de l'image
// PrÃ©visualisation de la photo dans le formulaire principal
document.getElementById('photo').addEventListener('change', function (event) {
  const preview = document.getElementById('preview');
  if (event.target.files.length > 0) {
    const file = event.target.files[0];
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

// PrÃ©visualisation de la photo dans le modal d'Ã©dition
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
  if (layers.length === 0) { toast('Ù„Ø§ ØªÙˆØ¬Ø¯ Ù…Ø³Ø§Ù‡Ù…Ø§Øª Ù„Ø¹Ø±Ø¶Ù‡Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø®Ø±ÙŠØ·Ø©.', 'alert'); return; }
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
    toast('Ø®Ø±ÙŠØ·Ø© Ø§Ù„Ø­Ø±Ø§Ø±Ø© Ù…ÙØ¹Ù„Ø©');
  } else {
    map.removeLayer(heatLayer);
    toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-pressed', 'false');
    toast('Ø®Ø±ÙŠØ·Ø© Ø§Ù„Ø­Ø±Ø§Ø±Ø© Ù…Ø¹Ø·Ù„Ø©');
  }
}
let dark = false;
function toggleStyle() {
  dark = !dark;
  const toggleBtn = document.getElementById('toggleStyle');
  if (dark) {
    map.removeLayer(tileDefault);
    tileToner.addTo(map);
    toast('Ø³Ù…Ø© Ø¯Ø§ÙƒÙ†Ø©', 'alert');
    toggleBtn.classList.add('active');
    toggleBtn.setAttribute('aria-pressed', 'true');
  }
  else {
    map.removeLayer(tileToner);
    tileDefault.addTo(map);
    toast('Ø³Ù…Ø© Ø§ÙØªØ±Ø§Ø¶ÙŠØ©');
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
  toast('ØªÙ… ØªØµØ¯ÙŠØ± Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø¨Ù†Ø¬Ø§Ø­.', 'success');
}
function importData(evt) {
  const f = evt.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed)) throw new Error('ØªÙ†Ø³ÙŠÙ‚ Ø§Ù„Ù…Ù„Ù ØºÙŠØ± ØµØ­ÙŠØ­.');

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
      toast(`âœ… ØªÙ… Ø§Ø³ØªÙŠØ±Ø§Ø¯ ${importedCount} Ù…Ø³Ø§Ù‡Ù…Ø©.`, 'success');
      document.getElementById('importFile').value = '';
    } catch (err) {
      toast('Ø®Ø·Ø£ ÙÙŠ Ù…Ù„Ù Ø§Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯: ' + err.message, 'error');
      document.getElementById('importFile').value = '';
    }
  };
  r.readAsText(f);
}
function clearAllData() {
  if (!confirm('Ù‡Ù„ ØªØ±ÙŠØ¯ Ù…Ø³Ø­ ÙƒÙ„ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­ÙÙˆØ¸Ø© Ù…Ø­Ù„ÙŠØ§Ù‹ØŸ Ù‡Ø°Ø§ Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡ Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ØªØ±Ø§Ø¬Ø¹ Ø¹Ù†Ù‡!')) return;
  entries = []; saveToStorage(); markerCluster.clearLayers(); applyFiltersAndSort(); toast('ØªÙ… Ù…Ø³Ø­ ÙƒÙ„ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª.', 'error');
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
      // Utiliser Ã  la fois click et touchend pour garantir la rÃ©activitÃ© sur mobile
      const handler = function (e) {
        e.preventDefault();
        e.stopPropagation(); // Ã‰viter la propagation qui pourrait fermer la sidebar

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

  // PrÃ©-remplir la liste des options de filtre de type
  const typeFilterSelect = document.getElementById('typeFilter');
  const existingTypes = new Set(Array.from(typeFilterSelect.options).map(o => o.value).filter(v => v));

  document.getElementById('type_arbre').querySelectorAll('option').forEach(option => {
    if (option.value && !existingTypes.has(option.value)) {
      const newOption = option.cloneNode(true);
      typeFilterSelect.appendChild(newOption);
      existingTypes.add(option.value);
    }
  });

  // GÃ©rer l'ouverture initiale du sidebar sur desktop (pour l'affichage du formulaire)
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

  // Attacher le bouton de gÃ©olocalisation aprÃ¨s l'initialisation complÃ¨te
  // Attendre un peu pour s'assurer que tous les Ã©lÃ©ments sont chargÃ©s (important pour mobile)
  setTimeout(function () {
    attachGeolocationButton();
  }, 300);

  // Exemple : charger une contribution depuis MongoDB (photo Base64 affichÃ©e dans la section dÃ©diÃ©e)
  loadRemoteSample();

  // Initialisation du calendrier moderne Flatpickr
  initFlatpickr();

  // FAB Event Listeners (Refactor: Explicit listeners with unique IDs)
  const fabAdd = document.getElementById('fab-add');
  if (fabAdd) {
    fabAdd.addEventListener('click', function (e) {
      e.preventDefault();
      toggleSidebar(true, 'form-panel');
    });
  }

  const fabList = document.getElementById('fab-list');
  if (fabList) {
    fabList.addEventListener('click', function (e) {
      e.preventDefault();
      toggleSidebar(true, 'list-panel');
    });
  }

  const fabStats = document.getElementById('fab-stats');
  if (fabStats) {
    fabStats.addEventListener('click', function (e) {
      e.preventDefault();
      toggleSidebar(true, 'stats-panel');
    });
  }
});

function initFlatpickr() {
  if (typeof flatpickr !== 'undefined') {
    const commonConfig = {
      locale: "ar", // Langue arabe
      altInput: true, // Afficher une version formatÃ©e
      altFormat: "j F Y", // ex: 15 mars 2025
      dateFormat: "Y-m-d", // Format envoyÃ© au backend (YYYY-MM-DD)
      maxDate: "today", // Pas de futur
      disableMobile: false, // Utiliser le calendrier custom mÃªme sur mobile (plus joli)
      theme: "material_green", // ThÃ¨me de base (sera surchargÃ© par CSS)
    };

    // Champ principal
    flatpickr("#date_planted", commonConfig);

    // Champ Ã©dition (si prÃ©sent)
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

  // CrÃ©er l'Ã©lÃ©ment pull-refresh
  pullRefreshElement = document.createElement('div');
  pullRefreshElement.className = 'pull-refresh';
  pullRefreshElement.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Ø¬Ø§Ø±ÙŠ Ø§Ù„ØªØ­Ø¯ÙŠØ«...</span>';
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
      // RafraÃ®chir les donnÃ©es
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

    // GÃ©rer la soumission du formulaire avec Enter
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

  if (!nom || !type) {
    showFormMessage('Ø§Ù„Ø§Ø³Ù… ÙˆÙ†ÙˆØ¹ Ø§Ù„Ø´Ø¬Ø±Ø© Ù…Ø·Ù„ÙˆØ¨Ø§Ù†', 'error');
    hapticFeedback('error');
    return;
  }
  if (isNaN(quantite) || quantite < 1) {
    showFormMessage('Ø§Ù„Ø±Ø¬Ø§Ø¡ ØªØ­Ø¯ÙŠØ¯ Ø¹Ø¯Ø¯ Ø§Ù„Ø£Ø´Ø¬Ø§Ø± (1 Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„)', 'error');
    hapticFeedback('error');
    return;
  }
  if (isNaN(lat) || isNaN(lng)) {
    showFormMessage('Ø§Ù„Ù…Ø±Ø¬Ùˆ ÙˆØ¶Ø¹ Ø§Ù„Ø¥Ø­Ø¯Ø§Ø«ÙŠØ§Øª', 'error');
    hapticFeedback('error');
    return;
  }

  const checkBounds = geojsonBounds || APPROX_BOUNDS;
  if (!checkBounds.contains([lat, lng])) {
    showFormMessage('Ø§Ù„Ø¥Ø­Ø¯Ø§Ø«ÙŠØ§Øª Ø®Ø§Ø±Ø¬ Ø­Ø¯ÙˆØ¯ Ø§Ù„Ø¬Ø²Ø§Ø¦Ø±', 'error');
    hapticFeedback('error');
    return;
  }

  hapticFeedback('success');

  // 1. Convertir en base64 pour localStorage (affichage local)
  let photoBase64 = null;
  if (photoFile) {
    try {
      photoBase64 = await convertImageToBase64(photoFile);
    } catch (error) {
      console.error('Erreur lors de la conversion de la photo:', error);
    }
  }

  // 2. Upload l'image vers le serveur pour obtenir une URL (pas de base64 en DB)
  let photoUrl = null;
  if (photoFile) {
    showFormMessage('Ø¬Ø§Ø±ÙŠ Ø±ÙØ¹ Ø§Ù„ØµÙˆØ±Ø©...', 'alert');
    photoUrl = await uploadImageToServer(photoFile);
    if (!photoUrl && photoBase64) {
      // Fallback: si l'upload Ã©choue, on utilisera le base64 localement seulement
      console.warn('Upload Ã©chouÃ©, utilisation du base64 pour affichage local uniquement');
    }
  }

  const submissionDate = datePlanted || new Date().toISOString();
  const id = 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  // Pour l'affichage local, on utilise photoUrl si disponible, sinon photoBase64
  const photoForDisplay = photoUrl || photoBase64;
  const entry = { id, nom, adresse, type, quantite, lat, lng, date: submissionDate, photo: photoForDisplay, createdAt: Date.now() };
  entries.unshift(entry);
  addEntryToMap(entry);
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  map.setView([lat, lng], 13);
  saveToStorage();
  applyFiltersAndSort();
  showDetailPanel(id);

  // Pour le serveur, on envoie l'URL (pas le base64 !)
  const dataToSend = { nom, adresse, type, quantite, lat, lng, date: submissionDate, photo: photoUrl };
  console.log("ðŸ“¤ Envoi vers le serveur :", dataToSend);

  try {
    const response = await fetch("https://greenalgeria-backend.onrender.com/api/contributions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataToSend)
    });

    const result = await response.json().catch(() => ({}));
    if (response.ok && result.success) {
      console.log("âœ… Arbre enregistrÃ© avec ID :", result.insertedId);
      alert("Arbre ajoutÃ© avec succÃ¨s !");
      showFormMessage('âœ… ØªÙ… Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ø´Ø¬Ø±Ø© Ø¨Ù†Ø¬Ø§Ø­!', 'success');
      resetForm();
      validateForm();
    } else {
      console.error("âŒ Erreur serveur :", result.error || 'RÃ©ponse invalide');
      alert("Erreur lors de l\'ajout de l\'arbre !");
      showFormMessage('Ø­Ø¯Ø« Ø®Ø·Ø£ Ø¹Ù†Ø¯ Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ø§Ù„Ø®Ø§Ø¯Ù…', 'error');
    }
  } catch (err) {
    console.error("âŒ Erreur fetch :", err);
    alert("Impossible de contacter le serveur !");
    showFormMessage('ØªØ¹Ø°Ø± Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ø§Ù„Ø®Ø§Ø¯Ù…. Ø­Ø§ÙˆÙ„ Ù„Ø§Ø­Ù‚Ø§Ù‹.', 'error');
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
      const contributor = latest.nom || 'Ù…Ø´Ø§Ø±Ùƒ Ù…Ø¬Ù‡ÙˆÙ„';
      const treeType = latest.type || 'Ù†ÙˆØ¹ ØºÙŠØ± Ù…Ø­Ø¯Ø¯';
      const createdAt = latest.createdAt ? new Date(latest.createdAt).toLocaleString('ar-EG') : '';
      const locality = [latest.city, latest.district].filter(Boolean).join(' â€” ');
      const locationTag = locality ? ` | ${locality}` : '';
      sampleInfo.textContent = `${contributor} â€” ${treeType}${locationTag}${createdAt ? ` (${createdAt})` : ''}`;
      sampleInfo.style.display = 'block';
    } else {
      sampleImg.style.display = 'none';
      sampleInfo.textContent = 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª Ù„Ø¹Ø±Ø¶Ù‡Ø§ Ø­Ø§Ù„ÙŠØ§Ù‹.';
      sampleInfo.style.display = 'block';
    }
  } catch (error) {
    console.warn('ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù…Ø«Ø§Ù„ Ø§Ù„ØµÙˆØ±Ø© Ù…Ù† Ø§Ù„Ø®Ø§Ø¯Ù…:', error);
    sampleImg.style.display = 'none';
    sampleInfo.textContent = 'ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù…Ø«Ø§Ù„ Ø§Ù„ØµÙˆØ±Ø© Ù…Ù† Ø§Ù„Ø®Ø§Ø¯Ù….';
    sampleInfo.style.display = 'block';
  }
}
