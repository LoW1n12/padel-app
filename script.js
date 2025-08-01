// webapp/script.js
const API_BASE_URL = "https://seven-maps-doubt.loca.lt"; // Замените на ваш актуальный URL

document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    tg.BackButton.hide();

    document.body.style.backgroundColor = tg.themeParams.bg_color || '#f0f3f8';

    const screens = {
        location: document.getElementById('location-screen'),
        calendar: document.getElementById('calendar-screen')
    };

    const modal = {
        overlay: document.getElementById('detail-modal'),
        dateHeader: document.getElementById('modal-date-header'),
        sessionsList: document.getElementById('modal-sessions-list'),
        closeBtn: document.getElementById('close-modal-btn'),
        notifyBtn: document.getElementById('add-notification-btn')
    };

    const locationList = document.getElementById('location-list');
    const calendarWrapper = document.getElementById('calendar-wrapper');
    const loaderContainer = document.getElementById('loader-container');
    const calendarGrids = {
        current: document.getElementById('calendar-grid-current'),
        next: document.getElementById('calendar-grid-next')
    };
    const monthYearHeaders = {
        current: document.getElementById('month-year-header-current'),
        next: document.getElementById('month-year-header-next')
    };
    const backBtn = document.getElementById('back-btn');

    let state = {
        selectedLocation: null,
        availableDates: new Set(),
        selectedDateForModal: null
    };

    function showScreen(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName].classList.add('active');
    }

    async function fetchAPI(path) {
        const response = await fetch(API_BASE_URL + path, {
            headers: { 'Bypass-Tunnel-Reminder': 'true' }
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }

    async function fetchLocations() {
        try {
            const data = await fetchAPI('/api/locations');
            renderLocations(data.locations);
        } catch (error) {
            locationList.innerHTML = `<div class="location-card"><h2>Ошибка</h2><p>Не удалось загрузить локации. Убедитесь, что бот и туннель запущены.</p></div>`;
            console.error('[ERROR] Не удалось загрузить локации:', error);
        }
    }

    async function fetchCalendarDataAndRender() {
        if (!state.selectedLocation) return;
        loaderContainer.classList.remove('hidden');
        calendarWrapper.classList.add('hidden');
        try {
            const data = await fetchAPI(`/api/calendar?location=${encodeURIComponent(state.selectedLocation)}`);
            state.availableDates = new Set(data.available_dates);
            console.log("[LOG] Даты с сеансами получены от API:", Array.from(state.availableDates));
            renderTwoMonthCalendar();
        } catch (error) {
            console.error('[ERROR] Ошибка загрузки данных для календаря:', error);
        } finally {
            loaderContainer.classList.add('hidden');
            calendarWrapper.classList.remove('hidden');
        }
    }

    function renderLocations(locations) {
        locationList.innerHTML = '';
        locations.forEach(loc => {
            const card = document.createElement('div');
            card.className = 'location-card';
            card.innerHTML = `<h2>${loc.name}</h2><p>${loc.description}</p>`;
            card.addEventListener('click', () => {
                state.selectedLocation = loc.id;
                document.getElementById('calendar-location-header').textContent = loc.name;
                fetchCalendarDataAndRender();
                showScreen('calendar');
                if (tg.isVersionAtLeast('6.1')) {
                    tg.BackButton.show();
                }
            });
            locationList.appendChild(card);
        });
    }

    function renderTwoMonthCalendar() {
        const now = new Date();
        const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
        const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        renderCalendar(currentMonthDate, calendarGrids.current, monthYearHeaders.current, true);
        renderCalendar(nextMonthDate, calendarGrids.next, monthYearHeaders.next, false);
    }

    function renderCalendar(date, gridElement, headerElement, isCurrentMonth) {
        gridElement.innerHTML = '';
        const year = date.getFullYear();
        const month = date.getMonth();
        headerElement.textContent = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();

        // Определяем с какого дня рисовать календарь
        const startDay = isCurrentMonth ? today.getDate() : 1;

        // Получаем день недели (понедельник=1,...,воскресенье=7)
        let firstRenderedDayOfWeek = new Date(year, month, startDay).getDay();
        if (firstRenderedDayOfWeek === 0) firstRenderedDayOfWeek = 7;

        if (isCurrentMonth) {
            for (let i = 1; i < firstRenderedDayOfWeek; i++) {
                const placeholder = document.createElement('div');
                placeholder.className = 'calendar-day is-placeholder';
                gridElement.appendChild(placeholder);
            }
        } else {
            let firstDayOfMonth = new Date(year, month, 1).getDay();
            if (firstDayOfMonth === 0) firstDayOfMonth = 7;
            for (let i = 1; i < firstDayOfMonth; i++) {
                gridElement.appendChild(document.createElement('div'));
            }
        }

        for (let day = startDay; day <= daysInMonth; day++) {
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day is-future';

            const fullDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const hasSessions = state.availableDates.has(fullDateStr);
            console.log(`[LOG] Проверка даты: ${fullDateStr}. Есть сеансы: ${hasSessions}`);

            if (hasSessions) {
                dayCell.classList.add('has-sessions');
                dayCell.addEventListener('click', () => onDateClick(fullDateStr));
            }

            const span = document.createElement('span');
            span.textContent = day;
            dayCell.appendChild(span);

            if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
                dayCell.classList.add('is-today');
            }

            gridElement.appendChild(dayCell);
        }
    }

    async function onDateClick(dateStr) {
        state.selectedDateForModal = dateStr;
        modal.dateHeader.textContent = new Date(dateStr).toLocaleDateString('ru-RU', {
            weekday: 'long', day: 'numeric', month: 'long'
        });
        modal.sessionsList.innerHTML = '<div class="list-item" style="justify-content:center;">Загрузка...</div>';
        modal.overlay.classList.add('visible');
        try {
            const data = await fetchAPI(
                `/api/sessions?location=${encodeURIComponent(state.selectedLocation)}&date=${dateStr}`
            );
            renderModalSessions(data);
        } catch (error) {
            modal.sessionsList.innerHTML = '<div class="list-item" style="justify-content:center;">Ошибка загрузки</div>';
            console.error('[ERROR] Ошибка загрузки сеансов:', error);
        }
    }

    function renderModalSessions(data) {
        modal.sessionsList.innerHTML = '';
        const sortedTimes = Object.keys(data).sort();
        if (sortedTimes.length === 0) {
            modal.sessionsList.innerHTML = '<div class="list-item" style="justify-content:center;">Свободных сеансов нет</div>';
            return;
        }
        const listWrapper = document.createElement('div');
        listWrapper.style.padding = '0 16px 16px';
        const list = document.createElement('div');
        list.style.borderRadius = '12px';
        list.style.overflow = 'hidden';

        sortedTimes.forEach(time => {
            const courtData = data[time];
            const details = Object.entries(courtData)
                .map(([type, info]) => `${type} - ${info.price} ₽`).join(' | ');
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<div class="list-item-title">${time}</div><div class="list-item-subtitle">${details}</div>`;
            list.appendChild(item);
        });
        listWrapper.appendChild(list);
        modal.sessionsList.appendChild(listWrapper);
    }

    function closeModal() {
        modal.overlay.classList.remove('visible');
    }

    async function onConfirmNotification() {
        tg.MainButton.showProgress();

        const subscription = {
            location: state.selectedLocation,
            hour: -1,
            court_types: ["Корт для 4-х", "Корт для 2-х", "Открытый корт", "Закрытый корт", "Корт (тип 1)", "Корт (тип 2)", "Ultra корт", "Корт"],
            monitor_data: { type: "specific", value: state.selectedDateForModal }
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/subscribe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Bypass-Tunnel-Reminder': 'true'
                },
                body: JSON.stringify({ initData: tg.initData, subscription: subscription })
            });

            if (!response.ok) throw new Error('Subscription failed');

            tg.showAlert('Уведомление успешно добавлено!');
        } catch (error) {
            tg.showAlert('Не удалось добавить уведомление.');
            console.error('[ERROR] Ошибка при подписке:', error);
        } finally {
            tg.MainButton.hideProgress();
            tg.MainButton.hide();
            tg.MainButton.offClick(onConfirmNotification);
            closeModal();
        }
    }

    function goBackToLocations() {
        showScreen('location');
        if (tg.isVersionAtLeast('6.1')) {
            tg.BackButton.hide();
        }
    }

    backBtn.addEventListener('click', goBackToLocations);
    tg.onEvent('backButtonClicked', goBackToLocations);
    modal.closeBtn.addEventListener('click', closeModal);
    modal.overlay.addEventListener('click', e => {
        if (e.target === modal.overlay) closeModal();
    });
    modal.notifyBtn.addEventListener('click', () => {
        tg.MainButton.setText(`Подтвердить на ${new Date(state.selectedDateForModal).toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'short'
        })}`);
        tg.MainButton.show();
        tg.MainButton.onClick(onConfirmNotification);
    });

    fetchLocations();
});
