
var coreAudio = require("node-core-audio");
var pitchFinder = require('pitchfinder');
var express = require('express');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

var five = require('johnny-five');
var smoothOut = 1;
var gain_for_amp = 0.4; 
var gain_for_pitch = 0.6;
var scaleFactor = 3;
var board = new five.Board();
var servoCreated = false;
var servo;
var servoMax = 85;
var servoMin= 20;
var smoothValue=0.8;

var pitch;

var detectPitchAMDF = new pitchFinder.AMDF({
	sampleRate:40000,
	minFrequency:5,
	maxFrequency:1200
});
var detectPitchDW = new pitchFinder.DynamicWavelet();

var last = new Date() //imposes a framerate with `var now`

//set up server
server.listen(3000);

app.use(express.static(__dirname + '/dist'));

app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

app.use(express.static(__dirname + '/css'));


//start of socket io 
io.on('connection', function (socket) {
	console.log("socket connection established!")
});







///////////////////////////////////////////////////////////////
//start of audio analysis//////////////////////////////////////
///////////////////////////////////////////////////////////////



// Create a new audio engine
var engine = coreAudio.createNewAudioEngine();

engine.setOptions({
	outputChannels:1,
	inputChannels:1,
	framesPerBuffer:400,
	sampleRate:40000
	});

// Add an audio processing callback
// This function accepts an input buffer coming from the sound card,
// and returns an ourput buffer to be sent to your speakers.
//
// Note: This function must return an output buffer
//		if you don't want the function to playback to your speakers,
//		return an array of 0 (maybe).


function processAudio( inputBuffer ) {
	var now = new Date()
	//vars `now` and `last` ensures it runs at 30fps
	if ((now-last)>34){	

		var ampRaw = Math.abs(Math.max.apply(Math, inputBuffer[0]));
		var ampGain = gain_for_amp*ampRaw
			if (ampGain>1) {
				ampGain = 1;
			};
		
		

		var ampBroadcast = broadcastAmp(ampGain);
		
		//console.log("inputBuffer: ",inputBuffer[0].length)
		//console.log("\n---------------------");
		//start of pitch analysis///////////////////////////////////////////
		
		pitch = detectPitchAMDF(inputBuffer[0]);
		if (pitch==null){
			pitch = 0
		}
		else{
			pitch = mapValue(pitch, 0,1000,0,1)
		}
		// console.log("AMDF: ",pitch);

		//applies gain to pitch
		var pitchGain = gain_for_pitch*pitch
			if (pitchGain>1.5) {
				pitchGain = 1.5;
			};

	
		//end of pitch analysis///////////////////////////////////////////
		
		//mixes amplitude and frequency, while scaling it up by scaleFactor.
		var ampPitchMix = (gain_for_amp*ampRaw+gain_for_pitch*pitch)*scaleFactor;
		
		//smooths values
		//Note: smoothValue is a number between 0-1
		smoothOut = smoothValue*smoothOut+(1-smoothValue)*ampPitchMix;
		
		//writes values to arduino
		setArduino(smoothOut);

		//resets timer to impose a framerate
		last = now;
		
		//broadcasts values to frontend
		var ampdBBroadcast = broadcastAmpGain(gain_for_amp)
		var pitchdBBroadcast = broadcastPitchGain(gain_for_pitch) 
		var mixdownBroadcast = broadcastMix(smoothOut);
		var pitchBroadcast = broadcastPitch(pitchGain);
		var smoothingBroadcast = broadcastSmoothing(smoothValue);
		var scalingBroadcast = broadcastScale(scaleFactor);


		}
		return inputBuffer;

}

engine.addAudioCallback( processAudio );



//////////////socket.io emit functions////////////////
function broadcastAmp(a) {
	
	io.emit("amp",a);
	return a;
}

function broadcastPitch(f0) {
	io.emit("pitch", f0);
	return f0;
}

function broadcastAmpGain(amp_gain) {
	io.emit("amp_gain", amp_gain);
	return amp_gain; //!!! return pitch_gain too~*
}

function broadcastPitchGain(pitch_gain) {
	io.emit("pitch_gain", pitch_gain);
	return pitch_gain;
}

function broadcastMix(mix){
	io.emit("mixdown", mix);
	return mix;
}

function broadcastScale(scale){
	io.emit("scale", scale);
	return scale;
}

function broadcastSmoothing(sv){
	io.emit("smoothing",sv);
	return sv;
}
//////////listens for updates from frontend/////////////////////////////

io.on('connection', function (socket) {
	console.log("connected to client!");
  	socket.on("updateParams", function (data) {

  		if ('ap_weight' in data){
  			gain_for_amp = data.ap_weight;
  			gain_for_pitch = 1-gain_for_amp;
  		}

  		if('amp_dB' in data){
  			gain_for_amp = data["amp_dB"];
  			console.log("\nnew amp gain: "+gain_for_amp);
  		}
  		if('pitch_dB' in data){
  			gain_for_pitch = data.pitch_dB;
  			console.log("\nnew pitch gain: "+gain_for_pitch);
  		}
  		if('scale' in data){
  			scaleFactor = data.scale;
  			console.log("\nnew scale factor: "+scaleFactor)
  		}
  		if('smoothing' in data){
  			smoothValue = data.smoothing;
  			console.log("\nnew smooth factor: "+smoothValue)
  		}
  		
    
 
  });
});

//////////////////////////////////////////////////////////////
//Arduino communication code/////////////////////////////////
////////////////////////////////////////////////////////////

board.on("ready", function() {

	servo = new five.Servo({
    pin: 10,
    startAt: 90
  });

  servoCreated=true;
});

function setArduino(smoothOut) {

	if (servoCreated){
		//maps the audio input to the servo value range, and calculates the difference
		//so that it moves upwards with increased amplitude.
		servo.to(servoMax-mapValue(smoothOut, 0, 1, servoMin, servoMax));
		
	};
};

function mapValue(value, minIn, maxIn, minOut, maxOut){
	return (value / (maxIn - minIn) )*(maxOut - minOut);
}


