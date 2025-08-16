document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('isLoggedIn') !== 'true') {
        window.location.href = 'login.html';
        return;
    }

    const logoutButton = document.getElementById('logout-button');

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('isLoggedIn');
        window.location.href = 'login.html';
    });

    const socket = io();

    const getPairingCodeButton = document.getElementById('get-pairing-code');
    const phoneNumberInput = document.getElementById('phone-number');
    const pairingCodeContainer = document.getElementById('pairing-code-container');
    const sessionList = document.getElementById('sessions');

    // Fetch and display the list of sessions on page load
    fetchSessions();

    getPairingCodeButton.addEventListener('click', async () => {
        const phoneNumber = phoneNumberInput.value.trim();
        if (!phoneNumber) {
            alert('Please enter a phone number.');
            return;
        }

        pairingCodeContainer.innerHTML = `Requesting pairing code for ${phoneNumber}...`;

        try {
            const response = await fetch('/api/sessions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phoneNumber })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }

            const session = await response.json();
            addSessionToList(session);
            phoneNumberInput.value = '';

        } catch (error) {
            pairingCodeContainer.innerHTML = `Error: ${error.message}`;
        }
    });

    socket.on('qr', ({ sessionId, qr }) => {
        const sessionElement = document.querySelector(`[data-session-id="${sessionId}"]`);
        if (sessionElement) {
            const qrCodeContainer = document.createElement('div');
            qrCodeContainer.innerHTML = `<h3>Scan QR Code</h3><img src="${qr}" alt="QR Code">`;
            sessionElement.appendChild(qrCodeContainer);
        }
    });

    socket.on('pairing-code', ({ sessionId, code }) => {
        const sessionElement = document.querySelector(`[data-session-id="${sessionId}"]`);
        if (sessionElement) {
            pairingCodeContainer.innerHTML = `Your pairing code is: <strong>${code}</strong>`;
        }
    });

    async function fetchSessions() {
        try {
            const response = await fetch('/api/sessions');
            const sessions = await response.json();
            sessionList.innerHTML = '';
            sessions.forEach(addSessionToList);
        } catch (error) {
            console.error('Error fetching sessions:', error);
        }
    }

    function addSessionToList(session) {
        const li = document.createElement('li');
        li.dataset.sessionId = session.id;
        li.className = 'py-4 flex justify-between items-center';
        li.innerHTML = `
            <span class="font-bold">${session.number}</span>
            <button class="delete-button bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded" data-session-id="${session.id}">Delete</button>
        `;
        sessionList.appendChild(li);
    }

    sessionList.addEventListener('click', async (event) => {
        if (event.target.classList.contains('delete-button')) {
            const sessionId = event.target.dataset.sessionId;
            try {
                const response = await fetch(`/api/sessions/${sessionId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    event.target.parentElement.remove();
                } else {
                    const error = await response.json();
                    alert(`Error deleting session: ${error.error}`);
                }
            } catch (error) {
                console.error('Error deleting session:', error);
            }
        }
    });
});