# Whisper Maps 3D

**Whisper Maps 3D** is an immersive, voice-activated geospatial application that combines high-fidelity visualization with advanced AI reasoning. Built on the **Google Maps JavaScript API (Alpha)** and **Gemini 2.5 Flash**, it allows users to navigate the globe, explore specific landmarks, and visualize real-time day/night cycles using simple natural language commands.

## Key Features

*   **Voice-First Control:** Navigate hands-free using the Web Speech API to pan, zoom, and fly to locations.
*   **Photorealistic 3D Rendering:** Utilizes Google's 3D Map Tiles for cinema-quality visualization of cities and terrain.
*   **AI-Powered Intelligence:** Integrated with **Gemini 2.5** via the **Model Context Protocol (MCP)** to interpret complex intents (e.g., "Show me the southernmost city") into precise map actions.
*   **Real-Time Atmospherics:** Features a dedicated "Space View" with orbital controls to visualize the Earth's real-time day/night terminator line.
*   **Smart Routing:** Displays 3D route polylines and markers for driving directions based on semantic queries.

## Getting Started

### Prerequisites

To run this application, you need valid API keys for Google services.

1.  **Google GenAI Key:** Obtain an API key from [Google AI Studio](https://aistudio.google.com/).
2.  **Google Maps API Key:** Enable "Maps JavaScript API" in the [Google Cloud Console](https://console.cloud.google.com/).

### Security & Setup

**Important:** Never commit your API keys to a public repository.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/hassaanfisky/whisper-maps-3d.git
    cd whisper-maps-3d
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Gemini API Key:**
    Ensure the environment variable `API_KEY` is set in your runtime environment (e.g., via a `.env` file or your hosting provider's dashboard).

4.  **Configure Google Maps API Key:**
    Open `map_app.ts` and locate the variable:
    ```typescript
    const USER_PROVIDED_GOOGLE_MAPS_API_KEY: string = 'YOUR_ACTUAL_KEY_HERE';
    ```
    Replace the placeholder with your actual Google Maps API key.
    *Tip: Restrict your Maps API key to your specific domain in the Google Cloud Console to prevent unauthorized use.*

### Running the App

Start the development server:

```bash
npm start
```

Open your browser (usually `http://localhost:8000` or `http://localhost:5173`) to view the app.

## Usage

**Voice Commands:**
Click the microphone button and speak naturally.
*   "Fly to the Eiffel Tower."
*   "Show me the dark side of the Earth."
*   "Take me to New York City."

**Text Commands:**
Type commands in the chat interface if you prefer not to use voice.
*   "Directions from London to Paris."
*   "Where is the tallest building in the world?"

## License

Apache-2.0
