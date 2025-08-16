document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('login-button');
    const passwordInput = document.getElementById('password');

    loginButton.addEventListener('click', async () => {
        const password = passwordInput.value;
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });

            if (response.ok) {
                localStorage.setItem('isLoggedIn', 'true');
                window.location.href = 'index.html';
            } else {
                const error = await response.json();
                alert(error.error);
            }
        } catch (error) {
            console.error('Error logging in:', error);
            alert('An error occurred while logging in.');
        }
    });
});