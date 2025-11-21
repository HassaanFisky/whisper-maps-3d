/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file defines the main `gdm-map-app` LitElement component.
 * This component is responsible for:
 * - Rendering the user interface, including the Google Photorealistic 3D Map,
 *   chat messages area, and user input field.
 * - Managing the state of the chat (e.g., idle, generating, thinking).
 * - Handling user input and sending messages to the Gemini AI model.
 * - Processing responses from the AI, including displaying text and handling
 *   function calls (tool usage) related to map interactions.
 * - Integrating with the Google Maps JavaScript API to load and control the map,
 *   display markers, polylines for routes, and geocode locations.
 * - Providing the `handleMapQuery` method, which is called by the MCP server
 *   (via index.tsx) to update the map display.
 */

// Google Maps JS API Loader: Used to load the Google Maps JavaScript API.
import {Loader} from '@googlemaps/js-api-loader';
import hljs from 'highlight.js';
import {html, LitElement, PropertyValueMap} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';

import {MapParams} from './mcp_maps_server';

/** Markdown formatting function with syntax hilighting */
export const marked = new Marked(
  markedHighlight({
    async: true,
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang, info) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, {language}).value;
    },
  }),
);

const ICON_BUSY = html`<svg
  class="rotating"
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 -960 960 960"
  width="24px"
  fill="currentColor">
  <path
    d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z" />
</svg>`;

/**
 * Chat state enum to manage the current state of the chat interface.
 */
export enum ChatState {
  IDLE,
  GENERATING,
  THINKING,
  EXECUTING,
}

/**
 * Chat tab enum to manage the current selected tab in the chat interface.
 */
enum ChatTab {
  GEMINI,
}

/**
 * Chat role enum to manage the current role of the message.
 */
export enum ChatRole {
  USER,
  ASSISTANT,
  SYSTEM,
}

// Google Maps API Key: Replace with your actual Google Maps API key.
const USER_PROVIDED_GOOGLE_MAPS_API_KEY: string =
  'AIzaSyAJPTwj4S8isr4b-3NtqVSxk450IAS1lOQ'; // <-- REPLACE THIS WITH YOUR ACTUAL API KEY

const EXAMPLE_PROMPTS = [
  "Take me to the North Pole.",
  "Let's go to Karachi, Pakistan.",
  "Fly to New York City.",
  "Show me Nazimabad.",
  "Visit Hyderabad.",
  "Go to San Francisco.",
  "Let's go here (current view)",
  "Show me the dark side of the Earth.",
];

/**
 * MapApp component for Photorealistic 3D Maps.
 */
@customElement('gdm-map-app')
export class MapApp extends LitElement {
  @query('#anchor') anchor?: HTMLDivElement;
  // Google Maps: Reference to the <gmp-map-3d> DOM element where the map is rendered.
  @query('#mapContainer') mapContainerElement?: HTMLElement; // Will be <gmp-map-3d>
  @query('#messageInput') messageInputElement?: HTMLInputElement;

  @state() chatState = ChatState.IDLE;
  @state() isRunning = true;
  @state() selectedChatTab = ChatTab.GEMINI;
  @state() inputMessage = '';
  @state() messages: HTMLElement[] = [];
  @state() mapInitialized = false;
  @state() mapError = '';
  @state() isListening = false;
  @state() showChatPanel = true; // Toggle for sidebar visibility

  // Google Maps: Instance of the Google Maps 3D map.
  private map?: any;
  // Google Maps: Instance of the Google Maps Geocoding service.
  private geocoder?: any;
  // Google Maps: Instance of the current map marker (Marker3DElement).
  private marker?: any;

  // Google Maps: References to 3D map element constructors.
  private Map3DElement?: any;
  private Marker3DElement?: any;
  private Polyline3DElement?: any;

  // Google Maps: Instance of the Google Maps Directions service.
  private directionsService?: any;
  // Google Maps: Instance of the current route polyline.
  private routePolyline?: any;
  // Google Maps: Markers for origin and destination of a route.
  private originMarker?: any;
  private destinationMarker?: any;

  // Camera state for toggling space view
  private savedCamera?: any;
  private orbitAnimationId: number | null = null;

  private recognition: any;

  sendMessageHandler?: CallableFunction;

  constructor() {
    super();
    // Set initial input from a random example prompt
    this.setNewRandomPrompt();
  }

  createRenderRoot() {
    return this;
  }

  protected firstUpdated(
    _changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>,
  ): void {
    // Google Maps: Load the map when the component is first updated.
    this.loadMap();
    
    // Stop orbit on user interaction to prevent fighting for control
    this.addEventListener('pointerdown', () => this.stopOrbit());
    this.addEventListener('wheel', () => this.stopOrbit());
  }

  /**
   * Sets the input message to a new random prompt from EXAMPLE_PROMPTS.
   */
  private setNewRandomPrompt() {
    if (EXAMPLE_PROMPTS.length > 0) {
      this.inputMessage =
        EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    }
  }

  /**
   * Initialize Web Speech API
   */
  private startListening() {
    this.stopOrbit(); // Stop rotation when interacting via voice
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert("Speech recognition not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!this.recognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false; // Stop after one sentence/command
      this.recognition.lang = 'en-US';
      this.recognition.interimResults = true; // Show text as we speak
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.showChatPanel = false; // Hide sidebar when listening starts
      };

      this.recognition.onend = () => {
        this.isListening = false;
        // If we have a result, send it automatically for "voice-to-command" experience
        if (this.inputMessage.trim().length > 0 && this.chatState === ChatState.IDLE) {
             this.sendMessageAction();
             // Keep sidebar hidden to let user see map result
             this.showChatPanel = false; 
        }
      };

      this.recognition.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
             this.inputMessage = event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        if (interimTranscript) {
             this.inputMessage = interimTranscript;
        }
        this.requestUpdate();
      };

      this.recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        if (event.error === 'not-allowed') {
          alert("Microphone access was denied. Please allow microphone access to use voice commands.");
        }
        this.isListening = false;
      };
    }

    try {
      this.recognition.start();
    } catch (e) {
      console.error("Failed to start recognition:", e);
      this.isListening = false;
    }
  }

  private stopListening() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  private toggleListening() {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.inputMessage = ''; 
      this.startListening();
    }
  }

  /**
   * Starts a slow rotation of the earth (by moving camera longitude)
   * to visualize the day/night cycle.
   */
  startOrbit() {
    if (this.orbitAnimationId) return;
    
    let lastTime = performance.now();
    const rotate = (time: number) => {
      if (!this.map) return;
      
      const deltaTime = time - lastTime;
      lastTime = time;

      // Rotate speed: degrees per second
      const speed = 2.0; 
      const deltaLng = speed * (deltaTime / 1000);

      const currentCenter = this.map.center;
      
      if (currentCenter && typeof currentCenter.lat === 'number') {
        // Avoid spreading map objects, access properties directly
        let newLng = currentCenter.lng - deltaLng; 
        
        // Normalize longitude
        if (newLng < -180) newLng += 360;
        
        // Directly update center for smooth animation without "flying"
        this.map.center = { lat: currentCenter.lat, lng: newLng, altitude: currentCenter.altitude };
      }

      this.orbitAnimationId = requestAnimationFrame(rotate);
    };
    
    this.orbitAnimationId = requestAnimationFrame(rotate);
  }

  stopOrbit() {
    if (this.orbitAnimationId) {
      cancelAnimationFrame(this.orbitAnimationId);
      this.orbitAnimationId = null;
    }
  }

  /**
   * Toggles between the current view and a "Space View" to see the terminator line.
   */
  private async toggleSpaceView() {
    if (!this.map) return;

    // Check if we are already "in space" (zoomed out enough to see the globe)
    const isSpace = this.map.range > 20000000;

    if (!isSpace) {
      const currentCenter = this.map.center;
      if (!currentCenter) return;
      
      // Save current camera state before zooming out
      // Important: Explicitly construct the object, do not spread map objects
      this.savedCamera = {
        center: { lat: currentCenter.lat, lng: currentCenter.lng, altitude: currentCenter.altitude },
        range: this.map.range,
        heading: this.map.heading,
        tilt: this.map.tilt
      };

      // Fly to Space View
      (this.map as any).flyCameraTo({
        endCamera: {
          center: { lat: 0, lng: currentCenter.lng, altitude: 0 }, 
          range: 25000000, // Distance to see the full globe
          heading: 0,
          tilt: 0
        },
        durationMillis: 3000
      });

      // Start rotating after the flight completes to show the terminator line
      setTimeout(() => {
         if (this.map.range > 20000000) {
             this.startOrbit();
         }
      }, 3100);

    } else {
      this.stopOrbit();
      // Fly back to saved location or default
      if (this.savedCamera) {
         (this.map as any).flyCameraTo({
          endCamera: this.savedCamera,
          durationMillis: 2000
        });
      } else {
         // Default fallback
         (this.map as any).flyCameraTo({
            endCamera: {
              center: { lat: 37.7749, lng: -122.4194, altitude: 0 }, // SF
              range: 5000,
              heading: 0,
              tilt: 45
            },
            durationMillis: 2000
         });
      }
    }
  }

  /**
   * Google Maps: Loads the Google Maps JavaScript API using the JS API Loader.
   */
  async loadMap() {
    const isApiKeyPlaceholder =
      USER_PROVIDED_GOOGLE_MAPS_API_KEY ===
        'YOUR_ACTUAL_GOOGLE_MAPS_API_KEY_REPLACE_ME' ||
      USER_PROVIDED_GOOGLE_MAPS_API_KEY === '';

    if (isApiKeyPlaceholder) {
      this.mapError = `Google Maps API Key is not configured correctly.`;
      console.error(this.mapError);
      this.requestUpdate();
      return;
    }

    const loader = new Loader({
      apiKey: USER_PROVIDED_GOOGLE_MAPS_API_KEY,
      version: 'alpha', // Use alpha for 3D maps stability
    });

    try {
      // Google Maps: Import 3D map specific library elements.
      const maps3dLibrary = (await (loader as any).importLibrary('maps3d')) as any;
      this.Map3DElement = maps3dLibrary.Map3DElement;
      this.Marker3DElement = maps3dLibrary.Marker3DElement;
      this.Polyline3DElement = maps3dLibrary.Polyline3DElement;

      // Google Maps: Import other required libraries
      await (loader as any).importLibrary('geocoding');
      await (loader as any).importLibrary('routes');
      await (loader as any).importLibrary('geometry');

      if ((window as any).google && (window as any).google.maps) {
        // Google Maps: Initialize the DirectionsService.
        this.directionsService = new (
          window as any
        ).google.maps.DirectionsService();
      }

      // Google Maps: Initialize the map itself.
      this.initializeMap();
      this.mapInitialized = true;
      this.mapError = '';
    } catch (error) {
      console.error('Error loading Google Maps API:', error);
      this.mapError =
        'Could not load Google Maps. Check console for details.';
      this.mapInitialized = false;
    }
    this.requestUpdate();
  }

  /**
   * Google Maps: Initializes the map instance and the Geocoder service.
   */
  initializeMap() {
    if (!this.mapContainerElement || !this.Map3DElement) {
      return;
    }
    // Google Maps: Assign the <gmp-map-3d> element to the map property.
    this.map = this.mapContainerElement;
    if ((window as any).google && (window as any).google.maps) {
      this.geocoder = new (window as any).google.maps.Geocoder();
    }
    
    // If we start in space (range is large), start orbit
    if (this.map.range && this.map.range > 20000000) {
        this.startOrbit();
    }
  }

  setChatState(state: ChatState) {
    this.chatState = state;
  }

  private _clearMapElements() {
    if (this.marker) {
      this.marker.remove();
      this.marker = undefined;
    }
    if (this.routePolyline) {
      this.routePolyline.remove();
      this.routePolyline = undefined;
    }
    if (this.originMarker) {
      this.originMarker.remove();
      this.originMarker = undefined;
    }
    if (this.destinationMarker) {
      this.destinationMarker.remove();
      this.destinationMarker = undefined;
    }
  }

  private async _handleViewLocation(locationQuery: string) {
    this.stopOrbit(); // Stop spinning if we navigate to a location
    if (
      !this.mapInitialized ||
      !this.map ||
      !this.geocoder ||
      !this.Marker3DElement
    ) {
      return;
    }
    this._clearMapElements(); 

    this.geocoder.geocode(
      {address: locationQuery},
      async (results: any, status: string) => {
        if (status === 'OK' && results && results[0] && this.map) {
          const location = results[0].geometry.location;

          const cameraOptions = {
            center: {lat: location.lat(), lng: location.lng(), altitude: 1000},
            heading: 0,
            tilt: 45,
            range: 4000, 
          };
          (this.map as any).flyCameraTo({
            endCamera: cameraOptions,
            durationMillis: 2500,
          });

          this.marker = new this.Marker3DElement();
          this.marker.position = {
            lat: location.lat(),
            lng: location.lng(),
            altitude: 0,
          };
          const label =
            locationQuery.length > 30
              ? locationQuery.substring(0, 27) + '...'
              : locationQuery;
          this.marker.label = label;
          (this.map as any).appendChild(this.marker);
        } else {
           // Error handling handled silently or could log
        }
      },
    );
  }

  private async _handleDirections(
    originQuery: string,
    destinationQuery: string,
  ) {
    this.stopOrbit(); // Stop spinning
    if (
      !this.mapInitialized ||
      !this.map ||
      !this.directionsService ||
      !this.Marker3DElement ||
      !this.Polyline3DElement
    ) {
      return;
    }
    this._clearMapElements();

    this.directionsService.route(
      {
        origin: originQuery,
        destination: destinationQuery,
        travelMode: (window as any).google.maps.TravelMode.DRIVING,
      },
      async (response: any, status: string) => {
        if (
          status === 'OK' &&
          response &&
          response.routes &&
          response.routes.length > 0
        ) {
          const route = response.routes[0];

          if (route.overview_path && this.Polyline3DElement) {
            const pathCoordinates = route.overview_path.map((p: any) => ({
              lat: p.lat(),
              lng: p.lng(),
              altitude: 5,
            })); 
            this.routePolyline = new this.Polyline3DElement();
            this.routePolyline.coordinates = pathCoordinates;
            this.routePolyline.strokeColor = 'blue';
            this.routePolyline.strokeWidth = 10;
            (this.map as any).appendChild(this.routePolyline);
          }

          if (
            route.legs &&
            route.legs[0] &&
            route.legs[0].start_location &&
            this.Marker3DElement
          ) {
            const originLocation = route.legs[0].start_location;
            this.originMarker = new this.Marker3DElement();
            this.originMarker.position = {
              lat: originLocation.lat(),
              lng: originLocation.lng(),
              altitude: 0,
            };
            this.originMarker.label = 'Origin';
            this.originMarker.style = {
              color: {r: 0, g: 128, b: 0, a: 1}, 
            };
            (this.map as any).appendChild(this.originMarker);
          }

          if (
            route.legs &&
            route.legs[0] &&
            route.legs[0].end_location &&
            this.Marker3DElement
          ) {
            const destinationLocation = route.legs[0].end_location;
            this.destinationMarker = new this.Marker3DElement();
            this.destinationMarker.position = {
              lat: destinationLocation.lat(),
              lng: destinationLocation.lng(),
              altitude: 0,
            };
            this.destinationMarker.label = 'Destination';
            this.destinationMarker.style = {
              color: {r: 255, g: 0, b: 0, a: 1}, 
            };
            (this.map as any).appendChild(this.destinationMarker);
          }

          if (route.bounds) {
            const bounds = route.bounds;
            const center = bounds.getCenter();
            let range = 10000; 

            if (
              (window as any).google.maps.geometry &&
              (window as any).google.maps.geometry.spherical
            ) {
              const spherical = (window as any).google.maps.geometry.spherical;
              const ne = bounds.getNorthEast();
              const sw = bounds.getSouthWest();
              const diagonalDistance = spherical.computeDistanceBetween(ne, sw);
              range = diagonalDistance * 1.7; 
            }
            range = Math.max(range, 2000); 

            const cameraOptions = {
              center: {lat: center.lat(), lng: center.lng(), altitude: 0},
              heading: 0,
              tilt: 45, 
              range: range,
            };
            (this.map as any).flyCameraTo({
              endCamera: cameraOptions,
              durationMillis: 2000,
            });
          }
        }
      },
    );
  }

  async handleMapQuery(params: MapParams) {
    this.stopOrbit(); // Stop orbit on any AI action
    if (params.location) {
      this._handleViewLocation(params.location);
    } else if (params.origin && params.destination) {
      this._handleDirections(params.origin, params.destination);
    } else if (params.destination) {
      this._handleViewLocation(params.destination);
    }
  }

  setInputField(message: string) {
    this.inputMessage = message.trim();
  }

  addMessage(role: string, message: string) {
    const div = document.createElement('div');
    div.classList.add('turn');
    div.classList.add(`role-${role.trim()}`);
    div.setAttribute('aria-live', 'polite');

    const thinkingDetails = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Thinking process';
    thinkingDetails.classList.add('thinking');
    const thinkingElement = document.createElement('div');
    thinkingDetails.append(summary);
    thinkingDetails.append(thinkingElement);
    div.append(thinkingDetails);

    const textElement = document.createElement('div');
    textElement.className = 'text';
    textElement.innerHTML = message;
    div.append(textElement);

    this.messages = [...this.messages, div];
    this.scrollToTheEnd();
    return {
      thinkingContainer: thinkingDetails,
      thinkingElement: thinkingElement,
      textElement: textElement,
    };
  }

  scrollToTheEnd() {
    if (!this.anchor) return;
    this.anchor.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }

  async sendMessageAction(message?: string, role?: string) {
    if (this.chatState !== ChatState.IDLE) return;

    let msg = '';
    let usedComponentInput = false; 

    if (message) {
      msg = message.trim();
    } else {
      msg = this.inputMessage.trim();
      if (msg.length > 0) {
        this.inputMessage = '';
        usedComponentInput = true;
      } else if (
        this.inputMessage.trim().length === 0 &&
        this.inputMessage.length > 0
      ) {
        this.inputMessage = '';
        usedComponentInput = true;
      }
    }

    if (msg.length === 0) {
      if (usedComponentInput) {
        this.setNewRandomPrompt();
      }
      return;
    }

    const msgRole = role ? role.toLowerCase() : 'user';

    if (msgRole === 'user' && msg) {
      const {textElement} = this.addMessage(msgRole, '...');
      textElement.innerHTML = await marked.parse(msg);
    }

    if (this.sendMessageHandler) {
      await this.sendMessageHandler(msg, msgRole);
    }

    if (usedComponentInput) {
      this.setNewRandomPrompt();
    }
  }

  private async inputKeyDownAction(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessageAction();
    }
  }

  render() {
    // Starting view: High altitude to see the globe/terminator line (Day/Night)
    const initialCenter = '0,0,0'; 
    const initialRange = '25000000'; 
    const initialTilt = '0'; 
    const initialHeading = '0'; 

    return html`<div class="gdm-map-app">
      <div
        class="main-container"
        role="application"
        aria-label="Interactive Map Area">
        ${this.mapError
          ? html`<div
              class="map-error-message"
              role="alert"
              aria-live="assertive"
              >${this.mapError}</div
            >`
          : ''}
        <gmp-map-3d
          id="mapContainer"
          style="height: 100%; width: 100%;"
          mode="hybrid"
          center="${initialCenter}"
          heading="${initialHeading}"
          tilt="${initialTilt}"
          range="${initialRange}"
          default-ui-disabled="true">
        </gmp-map-3d>
      </div>

      <!-- Floating Speech Bubble Overlay -->
      ${this.isListening ? html`
        <div class="speech-overlay">
          <div class="speech-bubble">
            ${this.inputMessage || "Listening..."}
          </div>
        </div>
      ` : ''}

      <!-- Sidebar (Chat) - Hides when speaking or explicitly toggled -->
      <div class="sidebar ${this.showChatPanel ? '' : 'hidden-sidebar'}">
        <div class="selector">
          <button
            id="geminiTab"
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.GEMINI,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.GEMINI;
            }}>
            <span>Gemini Agent</span>
          </button>
        </div>
        <div
          id="chat-panel"
          class=${classMap({
            'tabcontent': true,
            'showtab': this.selectedChatTab === ChatTab.GEMINI,
          })}>
          <div class="chat-messages">
            ${this.messages}
            <div id="anchor"></div>
          </div>
          <div class="footer">
            <div
              id="chatStatus"
              class=${classMap({'hidden': this.chatState === ChatState.IDLE})}>
              ${this.chatState === ChatState.GENERATING
                ? html`${ICON_BUSY} Generating...`
                : html``}
              ${this.chatState === ChatState.THINKING
                ? html`${ICON_BUSY} Thinking...`
                : html``}
              ${this.chatState === ChatState.EXECUTING
                ? html`${ICON_BUSY} Executing...`
                : html``}
            </div>
            <div id="inputArea">
              <input
                type="text"
                id="messageInput"
                .value=${this.inputMessage}
                @input=${(e: InputEvent) => {
                  this.inputMessage = (e.target as HTMLInputElement).value;
                }}
                @keydown=${(e: KeyboardEvent) => {
                  this.inputKeyDownAction(e);
                }}
                placeholder="Type a command..."
                autocomplete="off" />
              <button
                id="sendButton"
                @click=${() => {
                  this.sendMessageAction();
                }}
                ?disabled=${this.chatState !== ChatState.IDLE}
                class=${classMap({
                  'disabled': this.chatState !== ChatState.IDLE,
                })}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="24px"
                  viewBox="0 -960 960 960"
                  width="24px"
                  fill="currentColor">
                  <path d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Floating Action Buttons -->
      <div class="floating-controls">
        <!-- Toggle Sidebar Button (Small) -->
        <button class="control-btn mini-btn" @click=${() => this.showChatPanel = !this.showChatPanel} title="Toggle Chat">
          ${this.showChatPanel ? html`<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-360 280-560h400L480-360Z"/></svg>` : html`<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M240-800h480v200H240v-200Zm0 280h480v360H240v-360Zm80 80v200h320v-200H320Z"/></svg>`}
        </button>

        <!-- Main Mic Button -->
        <button
          id="micButton"
          class="control-btn mic-btn ${this.isListening ? 'listening' : ''}"
          @click=${this.toggleListening}
          title="Voice Command"
        >
            ${this.isListening 
              ? html`<svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 -960 960 960" width="32px" fill="currentColor"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Z"/></svg>` 
              : html`<svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 -960 960 960" width="32px" fill="currentColor"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Z"/></svg>`}
        </button>

        <!-- Toggle Day/Night (Global) View -->
        <button class="control-btn mini-btn" @click=${this.toggleSpaceView} title="Toggle Day/Night View">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-40-82v-78q-33 0-56.5-23.5T360-320v-40L168-552q-3 18-5.5 36t-2.5 36q0 121 79.5 212T440-162Zm276-102q20-22 36-47.5t26.5-53q10.5-27.5 16-56.5t5.5-59q0-98-54.5-179T600-776v16q0 33-23.5 56.5T520-680h-80v80q0 17-11.5 28.5T400-560h-80v80h240q17 0 28.5 11.5T600-440v120h40q26 0 47 15.5t29 40.5Z"/></svg>
        </button>
      </div>

    </div>`;
  }
}