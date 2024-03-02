<script>
  import {onDestroy, onMount} from 'svelte';
  import {writable} from 'svelte/store';
  import _ from 'lodash';
  import Radial from "$lib/programs/Radial.js";
  import Stars from "$lib/programs/Stars.js";

  let port, writer, textWriter, reader, reconnectTimeout;

  const connectionStatus = writable('Disconnected');
  const errorMessage = writable('');

  let usbConnected = false;
  let protocolConnected = false;

  let msg = '';
  let waitingMessageCbk  = null;
  let running = false;
  let fps = null;
  let config = null;
  let configSchema = null;

  let destroyCalled = false;

  let currentProgramName = "Radial";
  let currentProgram = null;

  const programs = {
    Radial,
    Stars,
  };

  async function connectSerial() {
    if ('serial' in navigator) {
      connectionStatus.set('Connecting...');
      errorMessage.set('');
      try {
        // Filter on devices with the Arduino Uno USB Vendor/Product IDs.
        const filters = [
          {usbVendorId: 4292},
        ];

        port = await navigator.serial.requestPort({filters});
        console.log("USB Port selected")
        console.log(port.getInfo())

        if (!port.readable) {
          await port.open({baudRate: 1500000});
        }

        if(!port.readable.locked) {
          writer = port.writable.getWriter();
          const textDecoder = new TextDecoderStream();
          const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
          reader = textDecoder.readable.getReader();

          window.writer = writer;
          window.reader = reader;
        } else {
          console.log("Re-reading writer from window.reader and window.writer")
          writer = window.writer;
          reader = window.reader;
        }

        usbConnected = true;
        connectionStatus.set(`Connected`);

        // const textEncoder = new TextEncoderStream();
        // const writableStreamClosed = textEncoder.readable.pipeTo(port.writable);

        // textWriter = textEncoder.writable.getWriter();

        setTimeout(() => initProtocol(), 100);

        // Listen to data coming from the serial device.
        let instance = Math.round(Math.random()*10000);
        while (true) {
          const {value, done} = await reader.read();
          if (done) {
            // Allow the serial port to be closed later.
            reader.releaseLock();
            console.log("Finished readding serial.")
            break;
          }
          // value is a string.
          msg += value;
          if (msg.includes('\n')) {
            // console.log("RAW MSG", JSON.stringify(msg))
            onMessage(msg.trim());
            msg = '';
          }
        }
      } catch (err) {
        console.error('There was an error opening the serial port:', err);
        errorMessage.set(`Error: ${err.message}`);
        connectionStatus.set('Disconnected');
        protocolConnected = false;
        usbConnected = false;
      }
    } else {
      console.error('Web Serial API not supported in this browser.');
      errorMessage.set('Error: Web Serial API not supported in this browser.');
    }
  }

  function onMessage(message) {
    // console.log(message);
    if(message === 'OK' && waitingMessageCbk) {
      waitingMessageCbk();
      waitingMessageCbk = null;
    } else if(message === 'YEAH') {
      protocolConnected = true;

      runProgram();
      if(waitingMessageCbk) {
        waitingMessageCbk();
        waitingMessageCbk = null;
      }
    } else if(message === 'RECONNECT') {
      protocolConnected = false;
      initProtocol();
    } else {
      console.log("UNEXPECTED MESSAGE: ", JSON.stringify(message))
      protocolConnected = false;
      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(initProtocol, 3000);
    }
  }

  async function initProtocol() {
    if(writer) {
      await writer.write(new Uint8Array(['X'.charCodeAt(0), 'X'.charCodeAt(0), 'X'.charCodeAt(0)]));
    } else {
      console.warn("No writer on init")
    }
  }


  const NUMBER_OF_LEDS = 300;
  const leds = _.range(NUMBER_OF_LEDS).map(() => [0,0,0]);
  const geometry = {
    x: new Array(NUMBER_OF_LEDS).fill(0),
    y: new Array(NUMBER_OF_LEDS).fill(0),
    z: new Array(NUMBER_OF_LEDS).fill(0),
    width: 100,
    height: 10,
    density: new Array(NUMBER_OF_LEDS).fill(1)
  };

  leds.forEach((x,i) => {
    geometry.x[i] = i;
    geometry.y[i] = 0;
    geometry.z[i] = 0;
  })

  async function runProgram() {
    if (writer) {
      if(!currentProgram) {
        setProgram(currentProgramName);
      }
      try {
        // await textWriter.write("XXX");

        let data;
        let frames = 0;
        let start = new Date().valueOf();
        let lastLog = start;
        currentProgram.timeInMs = 0;
        currentProgram.numberOfLeds = NUMBER_OF_LEDS;

        running = true;

        while (running) {
          currentProgram.drawFrame(leds);

          // console.log("LEDS", _.flatten(leds.slice(0,10)));

          data = new Uint8Array([4, ... _.flatten(leds.map(([r,g,b,a])=> [r,g,b]))]);

          await writer.write(data);

          await new Promise((done) => waitingMessageCbk = done);

          currentProgram.timeInMs = new Date() - start;

          frames++;

          const now = new Date().valueOf();
          let deltaT =  now - lastLog;
          if(deltaT > 1000) {
            fps = 1000 / (deltaT / frames);
            // console.log(`FPS: ${fps.toFixed(1)} in ${deltaT}ms`);
            lastLog = now;
            frames = 0;
          }
        }

        // Allow the serial port to be closed later.
        // writer.releaseLock();

        // console.log('Message sent');
      } catch (err) {
        stopEverything();
        console.error('There was an error sending data:', err);
        errorMessage.set(`Error sending data: ${err.message}`);
      }
    }
  }

  function setProgram(programName) {
    // if(running)
    //   stopProgram();

    currentProgramName = programName;

    let ProgramClass = programs[currentProgramName];

    config = ProgramClass.extractDefaults();
    configSchema = ProgramClass.configSchema();

    const newProgram = new ProgramClass(config, geometry, {});

    newProgram.timeInMs = currentProgram ? currentProgram.timeInMs : 0;
    newProgram.numberOfLeds = NUMBER_OF_LEDS;

    newProgram.init();

    currentProgram = newProgram;
  }

  function stopProgram() {
    running = false;
    fps = null;
  }

  onMount(() => {
    // Optionally, automatically request port connection on mount
    // connectSerial();
  });

  function stopEverything() {
    running = false;
    destroyCalled = true;
    fps = null;
    clearTimeout(reconnectTimeout);
    reader && reader.cancel();
    writer && writer.releaseLock();
  }

  onDestroy(stopEverything);
</script>

<div class="mainPanel" class:connected={usbConnected}>
    <h2>ESP32 Warro</h2>

    {#if !usbConnected }
        <button on:click={connectSerial}>Connect Serial Device</button>
    {/if}

    {#if protocolConnected }
        {#if running}
            <button on:click={stopProgram}>STOP</button>
            {#if fps}
                Running at {fps.toFixed(1)}fps
            {/if}

            <hr/>
            {#each Object.keys(programs) as program}
                <a href="javascript:void(0)" style="margin: 10px" on:click={() => setProgram(program)}>{program}</a>
            {/each}

            <hr/>
<!--            <pre>{JSON.stringify(configSchema, true, 4)}</pre>-->
            <h3>{currentProgram?.toString()}</h3>
            <table style="font-size: 12px;">
            {#each Object.entries(configSchema) as [param, {type, min, max, step}]}
                {#if type === Number}
                    <tr>
                        <td>{param}:</td>
                        <td><input type="range" {min} {max} {step} bind:value={config[param]}/></td>
                        <td>{config[param]}</td>
                    </tr>
                {:else if type === Boolean}
                    <tr>
                        <td>{param}:</td>
                        <td colspan="2"><input type="checkbox" bind:checked={config[param]}/></td>
                    </tr>
                {/if}
            {/each}
            </table>

            <pre>{JSON.stringify(config, true, 4)}</pre>
        {:else}
            <button on:click={runProgram}>PLAY</button>
        {/if}
    {:else if usbConnected}
        Initiating protocol...
    {/if}

<!--    <p>Connection status: {$connectionStatus}</p>-->
    {#if $errorMessage}
        <p class="error">Error: {$errorMessage}</p>
    {/if}
</div>

<style>
    .error {
        color: red;
    }

    :global(body) {
        font-family: Roboto, sans-serif;
        background: #333;
    }

    .mainPanel {
        background: #AAA;
        padding: 10px;
    }

    div.connected {
        background: lightgreen;
    }
</style>
