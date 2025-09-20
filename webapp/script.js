document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = "https://little-facts-hug.loca.lt";
    const tg = window.Telegram.WebApp;

    tg.ready();
    tg.expand();

    const elements = {
        dateTimeView: document.getElementById('date-time-view'),
        locationsView: document.getElementById('locations-view'),
        loader: document.getElementById('loader-container'),
        datePicker: document.getElementById('date-picker'),
        timeSelector: document.getElementById('time-selector'),
        findLocationsBtn: document.getElementById('find-locations-btn'),
        showAnyTimeBtn: document.getElementById('show-any-time-btn'),
        backToPickerBtn: document.getElementById('back-to-picker-btn'),
        selectedTimeDisplay: document.getElementById('selected-time-display'),
        showListBtn: document.getElementById('show-list-btn'),
        showMapBtn: document.getElementById('show-map-btn'),
        listView: document.getElementById('list-view'),
        mapView: document.getElementById('map-view'),
        locationList: document.getElementById('location-list'),
        mapContainer: document.getElementById('map'),
        locationPanel: {
            overlay: document.getElementById('location-panel-overlay'),
            name: document.getElementById('panel-location-name'),
            description: document.getElementById('panel-location-description'),
            availabilityStatus: document.getElementById('panel-availability-status'),
            bookBtn: document.getElementById('panel-book-btn'),
            notifyBtn: document.getElementById('panel-notify-btn'),
            showAllSessionsBtn: document.getElementById('panel-show-all-sessions-btn'),
            routeBtn: document.getElementById('panel-route-btn'),
            infoBtn: document.getElementById('panel-info-btn'),
            closeBtn: document.getElementById('panel-close-btn'),
        },
        allSessionsPanel: {
            overlay: document.getElementById('all-sessions-panel-overlay'),
            locationName: document.getElementById('all-sessions-location-name'),
            calendarContainer: document.getElementById('all-sessions-calendar-container'),
            backBtn: document.getElementById('all-sessions-back-btn'),
            closeBtn: document.getElementById('all-sessions-close-btn'),
        },
        infoPanel: {
            overlay: document.getElementById('info-panel-overlay'),
            backBtn: document.getElementById('info-panel-back-btn'),
            closeBtn: document.getElementById('info-panel-close-btn'),
            imageSliderWrapper: document.getElementById('info-image-slider-wrapper'),
            imageSlider: document.getElementById('info-image-slider'),
            locationName: document.getElementById('info-location-name-details'),
            locationAddress: document.getElementById('info-location-address'),
            locationDescription: document.getElementById('info-location-description'),
            routeBtn: document.getElementById('info-route-btn'),
            bookingBtn: document.getElementById('info-booking-btn'),
        }
    };

    let state = {
        locations: [], map: null,
        selectedDate: new Date(),
        selectedTime: null, isAnyTime: true,
        currentLocData: null,
    };

    const fp = flatpickr(elements.datePicker, {
        defaultDate: "today", locale: "ru", minDate: "today",
        inline: true,
        onChange: (selectedDates) => {
            state.selectedDate = selectedDates[0];
            updateFindButtonState();
        }
    });

    function generateTimeSlots() {
        for (let hour = 7; hour <= 23; hour++) {
            const time = `${String(hour).padStart(2, '0')}:00`;
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.textContent = time;
            slot.dataset.time = time;
            slot.addEventListener('click', () => {
                document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
                slot.classList.add('selected');
                state.selectedTime = time;
                state.isAnyTime = false;
                updateFindButtonState();
            });
            elements.timeSelector.appendChild(slot);
        }
    }

    function updateFindButtonState() {
        elements.findLocationsBtn.disabled = !state.selectedTime && !state.isAnyTime;
    }

    function switchView(viewName) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewName).classList.add('active');
    }

    async function findLocations() {
        switchView('locations-view');
        elements.loader.classList.remove('hidden');
        elements.locationList.innerHTML = '';
        
        const dateStr = state.selectedDate.toISOString().split('T')[0];
        let url = '/api/locations';
        if (!state.isAnyTime) {
            url += `?date=${dateStr}&time=${state.selectedTime}`;
        }
        
        displaySelectedTime();

        try {
            const data = await fetch(`${API_BASE_URL}${url}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }).then(res => res.json());
            state.locations = data.locations;
            renderLocations(state.locations);
            renderMap(state.locations);
        } catch (e) {
            tg.showAlert('Не удалось загрузить локации');
        } finally {
            elements.loader.classList.add('hidden');
        }
    }

    function displaySelectedTime() {
        if (state.isAnyTime) {
            elements.selectedTimeDisplay.textContent = "Любое время";
        } else {
            const date = state.selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            const weekday = state.selectedDate.toLocaleDateString('ru-RU', { weekday: 'short' });
            elements.selectedTimeDisplay.textContent = `${date}, ${weekday} | ${state.selectedTime}`;
        }
    }
    
    function renderLocations(locations) {
        elements.locationList.innerHTML = '';
        locations.forEach(loc => {
            const card = document.createElement('div');
            card.className = `location-card ${loc.available ? 'available' : 'unavailable'}`;
            card.innerHTML = `<h2>${loc.name}</h2><p>${loc.description}</p>`;
            card.addEventListener('click', () => showLocationPanel(loc));
            elements.locationList.appendChild(card);
        });
    }

    function renderMap(locations) {
        if (!state.map) {
            ymaps.ready(() => {
                state.map = new ymaps.Map(elements.mapContainer, { center: [55.751244, 37.618423], zoom: 10, controls: [] });
                addPlacemarks(locations);
            });
        } else {
            addPlacemarks(locations);
        }
    }

    function addPlacemarks(locations) {
        if (state.map) {
            state.map.geoObjects.removeAll();
            locations.forEach(loc => {
                if (loc.coords && loc.coords.length === 2) {
                    const markerClass = loc.available ? 'available' : 'unavailable';
                    const customMarkerLayout = ymaps.templateLayoutFactory.createClass(`<div class="custom-marker ${markerClass}">🎾</div>`);
                    const placemark = new ymaps.Placemark(loc.coords, {}, { iconLayout: customMarkerLayout, iconShape: { type: 'Rectangle', coordinates: [[-18, -18], [18, 18]] } });
                    placemark.events.add('click', () => showLocationPanel(loc));
                    state.map.geoObjects.add(placemark);
                }
            });
        }
    }

    function showLocationPanel(locData) {
        state.currentLocData = locData;
        
        elements.locationPanel.name.textContent = locData.name;
        elements.locationPanel.description.textContent = locData.description;

        const isAvailable = locData.available;
        elements.locationPanel.bookBtn.classList.toggle('hidden', !isAvailable);
        elements.locationPanel.notifyBtn.classList.toggle('hidden', isAvailable || state.isAnyTime);
        elements.locationPanel.availabilityStatus.classList.toggle('hidden', isAvailable);
        if (!isAvailable && !state.isAnyTime) {
            elements.locationPanel.availabilityStatus.textContent = 'На выбранное время сеансов нет';
        }

        if (isAvailable && locData.booking_link) {
            elements.locationPanel.bookBtn.href = locData.booking_link;
        }

        elements.locationPanel.overlay.classList.add('visible');
    }

    async function showAllSessionsPanel(locData) {
        elements.allSessionsPanel.locationName.textContent = locData.name;
        elements.allSessionsPanel.calendarContainer.innerHTML = '<div class="padel-loader"></div>';
        elements.allSessionsPanel.overlay.classList.add('visible');

        try {
            const data = await fetch(`${API_BASE_URL}/api/calendar?location_id=${locData.id}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }).then(res => res.json());
            const availableDates = new Set(data.available_dates);
            
            const calendar = document.createElement('div');
            const calFp = flatpickr(calendar, {
                inline: true, locale: 'ru',
                onDayCreate: (dObj, dStr, fp, dayElem) => {
                    const dateStr = fp.formatDate(dayElem.dateObj, "Y-m-d");
                    if (availableDates.has(dateStr)) {
                        dayElem.classList.add("has-sessions");
                    }
                },
                // Add on-click logic for days later if needed
            });
            elements.allSessionsPanel.calendarContainer.innerHTML = '';
            elements.allSessionsPanel.calendarContainer.appendChild(calendar);

        } catch (e) {
            elements.allSessionsPanel.calendarContainer.innerHTML = '<p>Не удалось загрузить расписание</p>';
        }
    }

    function showInfoPanel(locData) {
        elements.infoPanel.locationName.textContent = locData.name;
        elements.infoPanel.locationAddress.textContent = locData.address || 'Адрес не указан';
        elements.infoPanel.locationAddress.classList.toggle('is-placeholder', !locData.address);
        elements.infoPanel.locationDescription.textContent = locData.description || '';
        elements.infoPanel.imageSlider.innerHTML = '';
        if (locData.images && locData.images.length > 0) {
            locData.images.forEach(src => {
                const img = document.createElement('img');
                img.src = src;
                elements.infoPanel.imageSlider.appendChild(img);
            });
            elements.infoPanel.imageSliderWrapper.style.display = 'block';
        } else {
            elements.infoPanel.imageSliderWrapper.style.display = 'none';
        }
        if (locData.booking_link) {
            elements.infoPanel.bookingBtn.href = locData.booking_link;
            elements.infoPanel.bookingBtn.style.display = 'flex';
        } else {
            elements.infoPanel.bookingBtn.style.display = 'none';
        }
        elements.infoPanel.overlay.classList.add('visible');
    }

    // --- Event Listeners ---
    elements.findLocationsBtn.addEventListener('click', findLocations);
    elements.showAnyTimeBtn.addEventListener('click', () => {
        state.isAnyTime = true;
        findLocations();
    });

    elements.backToPickerBtn.addEventListener('click', () => switchView('date-time-view'));
    elements.showListBtn.addEventListener('click', () => {
        elements.listView.classList.add('active');
        elements.mapView.classList.remove('active');
    });
    elements.showMapBtn.addEventListener('click', () => {
        elements.listView.classList.remove('active');
        elements.mapView.classList.add('active');
        if (!state.map) renderMap(state.locations);
    });

    elements.locationPanel.closeBtn.addEventListener('click', () => elements.locationPanel.overlay.classList.remove('visible'));
    elements.locationPanel.overlay.addEventListener('click', (e) => { if (e.target === elements.locationPanel.overlay) elements.locationPanel.overlay.classList.remove('visible'); });
    elements.locationPanel.routeBtn.addEventListener('click', () => tg.openLink(`https://yandex.ru/maps/?rtext=~${state.currentLocData.coords.join(',')}`));
    elements.locationPanel.infoBtn.addEventListener('click', () => showInfoPanel(state.currentLocData));
    elements.locationPanel.showAllSessionsBtn.addEventListener('click', () => {
        elements.locationPanel.overlay.classList.remove('visible');
        showAllSessionsPanel(state.currentLocData);
    });

    elements.allSessionsPanel.closeBtn.addEventListener('click', () => elements.allSessionsPanel.overlay.classList.remove('visible'));
    elements.allSessionsPanel.backBtn.addEventListener('click', () => {
        elements.allSessionsPanel.overlay.classList.remove('visible');
        showLocationPanel(state.currentLocData);
    });

    elements.infoPanel.closeBtn.addEventListener('click', () => elements.infoPanel.overlay.classList.remove('visible'));
    elements.infoPanel.overlay.addEventListener('click', (e) => { if (e.target === elements.infoPanel.overlay) elements.infoPanel.overlay.classList.remove('visible'); });
    elements.infoPanel.backBtn.addEventListener('click', () => elements.infoPanel.overlay.classList.remove('visible'));
    elements.infoPanel.routeBtn.addEventListener('click', () => tg.openLink(`https://yandex.ru/maps/?rtext=~${state.currentLocData.coords.join(',')}`));
    
    // --- Init ---
    generateTimeSlots();
    updateFindButtonState();
});
