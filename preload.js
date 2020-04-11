const fs = require('fs');
const Mousetrap = require('mousetrap');
const player = require('node-wav-player');
const { dialog } = require('electron').remote;
var ctx;
var canvas, canvas2;
var project;
var waveCan;
var logBox = false;
var rendSet = { 	//render settings, for the canvas
	start: 0, 		//first start render
	spp: 1024,	 	//samples per pixel
	rsr: 1024,	 	//render sample ratio
	viewingChan: -1 //specific channel being looked at
};
var exportSet = {		      	//export settings
	smoothingRate: 64,        	//how many samples to smooth
	depoppingSensitivity: 256,
	finalSpeedFactor: 1,
	blurLength: 256, 		  	//measured in samples
	invertReverses: false
};

const ruleSampleLabelSpace = 18; //how much vertical space to give to sample labels
const ruleDraggerSpace = 18; //how much vertical space to give to the dragging tool
const ruleBottomspace = 24; //how many pix to add to the bottom of the wavefrom canvas for the rules
const measureBottomspace = 32; //how many pix to add to the bottom of the wavefrom canvas for the ruler
const ruleHeadspace = 128-measureBottomspace-ruleBottomspace; //how many pix to add to the top of the wavefrom canvas for rule controls
const canvasFontSize = 24;

const numQuickPatternBoxes = 8;

const tabs = [
	["varTabButton","variablesHolder"],
	["expTabButton","exportSettingsHolder"]
];





//███████████████████████████████████████████//PROJECT CLASS//███████████████████████████████████████████//

class projectClass{
	constructor(){
		this.WAVFile = new WAVFile();
		this.rules = [];
		this.ruleHistoryStack = [];
		this.maxHistorySize = 32;
		this.historyPosition = 0;
		this.selection = new selectionClass(this.rules);
	}
	addRule(inRule,pos){
		if(isNotNum(pos)) pos = this.rules.length;
		rules.splice(pos, 0, new rule(inRule));
		this.selection.ruleAdded(pos);
	}
	addRuleArray(ruleArry,pos){
		for(var i = 0; i < ruleArry.length; i++){
			this.addRule(ruleArry[i],pos);
			pos++;
		}
	}
	delRule(pos){
		if(typeof pos !== 'number') pos = this.rules.length;
		rules.splice(pos, 1);
		this.selection.ruleRemoved(pos);
	}
	delRuleArray(indexArray){ //note, these should be -in order-
		var offset = 0;
		for(var i = 0; i < indexArray.length; i++){
			this.delRule(indexArray[i]+offset);
			offset--; //because it gets shifted down every time
		}
	}
	delAllRules(){
		while(rules.length) this.delRule(0);
	}
	replaceRules(inRules){
		this.delAllRules();
		this.addRuleArray(inRules);
	}
	getRuleByStartPos(pos){
		for(var i = 0; i < this.rules.length; i++) if(pos >= this.rules[i].start && pos <= this.rules[i].end) return this.rules[i]; 
		return undefined;
	}
	getRuleIndexByStartPos(pos){
		for(var i = 0; i < this.rules.length; i++) if(pos >= this.rules[i].start && pos <= this.rules[i].end) return i; 
		return -1;
	}
	pushRules(){
		if(this.historyPosition !== this.maxHistorySize) this.ruleHistoryStack.splice(this.historyPosition,this.maxHistorySize); //delete all history above the current
		var holdRules = cloneRulesArray(this.rules);
		this.ruleHistoryStack.push(holdRules);
		while(this.ruleHistoryStack.length > this.maxHistorySize) this.ruleHistoryStack.shift(); //lower back down to the max
		this.historyPosition = this.ruleHistoryStack.length;
	}
	undoRules(){//fragile
		var holdRules;
		if(this.historyPosition == 0) return false;
		holdRules = cloneRulesArray(this.rules); //get the current state
		this.replaceRules(cloneRulesArray(this.ruleHistoryStack[--this.historyPosition]));
		this.ruleHistoryStack[this.historyPosition] = holdRules;
		return true;
	}
	redoRules(){//do not touch
		var holdRules;
		if(this.historyPosition == this.ruleHistoryStack.length) return false;
		holdRules = cloneRulesArray(this.rules); //get the current state
		this.replaceRules(cloneRulesArray(this.ruleHistoryStack[this.historyPosition++]));
		this.ruleHistoryStack[this.historyPosition-1] = holdRules;
		return true;
	}
}


class selectionClass{
	constructor(rules){
		this.indexes = [];
		this.rules = rules; //this holds a pointer to the rules arrayobject of its parent projectClass to for calculation reasons.
	}
	getStart(){
		if(this.indexes.length) return this.rules[this.indexes[0]].start;
		return -1;
	}
	getEnd(){
		if(this.indexes.length) return this.rules[this.indexes.last()].end;
		return -1;
	}
	getLength(){
		return this.getEnd()-this.getStart();
	}
	getFirstRule(){
		return this.rules[this.indexes[0]];
	}
	getLastRule(){
		return this.rules[this.indexes.last()];
	}
	getFirstRuleIndex(){
		if(this.indexes.length == 0) return -1;
		return this.indexes[0];
	}
	getLastRuleIndex(){
		if(this.indexes.length == 0) return -1;
		return this.indexes.last();
	}
	getAllSelectedIndexes(){
		return this.indexes.clone();
	}
	getAllSelectedRules(){
		var ret = [];
		for(var i = 0; i < this.indexes.length; i++) ret.push(this.rules[this.indexes[i]]);
		return ret;
	}
	ruleAdded(index){//call this when a rule is added to the rules list in the project object to ensure continuity
		for(var i = 0; i < this.indexes.length; i++) if(index<=this.indexes[i]) this.indexes[i]++; //shift up
	}
	ruleRemoved(index){
		this.deselect(index);
		for(var i = 0; i < this.indexes.length; i++) if(index<=this.indexes[i]) this.indexes[i]--; //shift down
	}
	select(index){
		if(this.indexes.length){
			if(this.isSelected(index)) return -1; //if it's already selected
			if(index < this.indexes[0]){ this.indexes.unshift(index); return 0;}
			if(index > this.indexes.last()){ this.indexes.push(index); return this.indexes.length-1}
			for(var i = 0; i<this.indexes.length-1; i++){
				if(index > this.indexes[i] && index < this.indexes[i+1]){ this.indexes.splice(i+1,0,index); return i+1;}
			}//it returns the index of the selected item in the selection
		}
		this.indexes.push(index);
		return 0;
	}
	selectRange(start,end){ //pass it a range within the rules[] array
		if(start > end){
			var hold = end;
			end = start;
			start = hold; //flip 'em
		}
		if(start < this.rules.length && end > -1 && isNum(start) && isNum(end)){
			if(start < 0) start = 0;
			if(end > this.rules.lastIndex()) end = this.rules.lastIndex();
			for(var i = start; i<= end; i++) this.select(i);
		}else{
			log("!ERROR! selection.selectRange() was passed an invalid range (["+start+","+end+"] of [0,"+this.rules.lastIndex()+"])");
		}
	}
	deselect(index){
		for(var i = 0; i<this.indexes.length; i++) if(this.indexes[i] == index){ this.indexes.splice(i,1); return true;}
		return false;
		//returns true if item was removed
	}
	isSelected(index){
		for(var i = 0; i<this.indexes.length; i++) if(this.indexes[i] == index) return true;
		return false;
	}
	selected(index){
		return this.isSelected(index);
	}
	numSelected(){
		return this.indexes.length;
	}
	flipSelection(index){
		if(!this.deselect(index)){
			this.select(index); //if deselect fails, select it
			return true;
		}
		return false; //returns what it now is
	}
	selectAll(){
		this.clear();
		for(var i = 0; i < this.rules.length; i++) this.indexes.push(i);
	}
	clear(){
		this.indexes = [];
	}
	isContinuous(){
		for(var i = 0; i<this.indexes.length-1; i++) if(this.indexes[i] !== this.indexes[i+1]-1) return false;
		return true;
	}
	scaleSelection(factor){
		if(this.isContinuous() && this.indexes.length > 0){
			var holdLength = this.getLength();
			for(var i = 0; i < this.indexes.length; i++){ this.rules[this.indexes[i]].length *= factor.abs(); }
			bakeRuleArrayPositions(this.rules);
			return holdLength - this.getLength(); //return by how much it shrank
		}
		return -1;
	}
}


function cloneRulesArray(inAry){
	var ret = [];
	for(var i = 0; i < inAry.length; i++) ret[i] = new rule(inAry[i]);
	return ret;
}

function saveRuleListToFile(path,holdRules){
	fs.writeFile(path, JSON.stringify(holdRules), () => {log("!Rule file saved")});
}

function loadRulesFromFile(fileName){
	var holdRules = JSON.parse(fs.readFileSync(fileName));
	holdRules = cloneRulesArray(holdRules); //saving to JSON loses classhood.  So we clone each back into a class to restore them.  Don't worry, this method takes care of the samples too
	log("!File loaded");
	return holdRules;
}


//███████████████████████████████████████████//SKIPJACKER VARIABLES//███████████████████████████████████████████//

var lastAbsolute = 0;
var lastShift = 0;
var desiredRatio = 1;
var inFile = "in.wav";
var outFile = "out.wav";
var ruleFile = "rule.txt";
var exportSampleRate = 0;
var sampleCoefficient = 1;
var quiet = false;

var inWAV, outWAV;
var inWav = inWAV, outWav = outWAV; //I keep misspelling this and bricking the program, so I'll just be lazy and define both

var rules;
var selection;
var clipboard = [];
var playingAudio = false;

var holdObj, holdVal, holdVal2, holdIndex;








//███████████████████████████████████████████//GENERAL FUNCTIONS//███████████████████████████████████████████//

var mouse = { x: -1, y: -1 , lx: -1, ly: -1, m1: false, overSample: -1, selecting: false};

function log(text){
	if(logBox){
		logBox.innerHTML = logBox.innerHTML+"\n"+text;
		logBox.scrollTop = logBox.scrollHeight;
	}else{ //if box isn't loaded yet, put it in the console
		console.log(text);
	}
}

function log2(...args) {//for logging many vars
	var say = "";
	args.forEach(arg => say = say+arg+"█");
	log(say);
}

var clog = console.log;

function dlog(text){
	if(debug) console.log(text);
}

function getMaxValueForNumberOfBytes(bytes){
	bytes = r(bytes.abs()); //should round and abs it to be safe
	var ret = 1;
	while(bytes--) ret*=256;
	return ret;
}

function isNotNum(num){
	if(typeof num !== 'number' || isNaN(num)) return true;
	return false;
}

function isNum(num){
	if(typeof num == 'number' && !isNaN(num)) return true;
	return false;
}

function pInt(inNum){
	inNum = parseInt(inNum);
	if(inNum == NaN) inNum = 0;
	return inNum;
}

function pFloat(inNum){
	inNum = parseFloat(inNum);
	if(inNum == NaN) inNum = 0;
	return inNum;
}

function relog(text){
	process.stdout.clearLine();
	process.stdout.cursorTo(0);
	process.stdout.write("$"+text);
}

String.prototype.pad = function(len,chr,front){
	if(chr == undefined) chr = "0";
	var ret = this;
	if(front){
		while(ret.length<len) ret = chr+ret;
	}else{
		while(ret.length<len) ret = ret+chr;
	}
	return ret;
};

String.prototype.estWidth = function(size){ //size being textSize
	if(size == undefined || size <= 0) size = canvasFontSize;
	return this.length*size*0.6;
};

String.prototype.numerics = function(){
	return this.replace(/[^\d.-]/g,'');
};

String.prototype.splice = function(start, delCount, newSubStr) {
	return this.slice(0, start) + newSubStr + this.slice(start + Math.abs(delCount));
};// thank you, https://stackoverflow.com/questions/4313841/insert-a-string-at-a-specific-index

Number.prototype.pad = function(len,chr,front){
	return this.toString(10).pad(len,chr,front);
};

Number.prototype.mod = function(n) {
		return ((this%n)+n)%n;
}; //thank you, https://web.archive.org/web/20090717035140if_/javascript.about.com/od/problemsolving/a/modulobug.htm

Number.prototype.abs = function(n) {
		if(this < 0) return this*-1;
	return this;
};

Number.prototype.constr = function(l,h){
	if(this < l) return l;
	if(this > h) return h;
	return this;
}

Number.prototype.sign = function(n) {
		if(this){
		return this/this.abs();
	}else{
		return this;
	}
};

Array.prototype.insert = function(index, inary) {
	while(inary.length){this.splice(++index, 0, inary.shift());}
};

Array.prototype.last = function() {
	return this[this.length-1];
};

Array.prototype.lastIndex = function() {
	return this.length-1; //sounds useless, but makes some things simpler
};

Array.prototype.replace = function(index, length, inary) {
	var ret = this.splice(index, length); //delete
	while(inary.length){this.splice(++index, 0, inary.shift());}
	return ret; //you might want to keep what you deleted
};

Array.prototype.clone = function() {//non-destructive reverse function
	var ret = [];
	for(var i = 0; i < this.length; i++) ret[i] = this[i];
	return ret;
};

Array.prototype.reverseSafe = function() {//non-destructive reverse function
	var ret = [];
	for(var i = this.length-1; i>=0; i--) ret.push(this[i]);
	return ret;
};

Array.prototype.inBounds = function(i) {//check if an index is in the range of the array
	if(isNotNum(i) || i < 0 || i > this.lastIndex() || i != r(i)) return false;
	return true;
};

function round(num){//just makes things easier
	return Math.round(num);
};

const r = round; //even easier

const pow = Math.pow;

function rng(l,h,R){ //easy rng
	if(R){
		return r(Math.random()*(h-l)+l);
	}else{
		return Math.random()*(h-l)+l;
	}
}

function forceNum(num){
	if(typeof num == 'string') num = pFloat(num);
	if(isNotNum(num)) num = 0;
	return num;
}

function truncate(num, res){
	if(res == undefined) res = 1000;
	return r(num*res)/res;
}

function fileToUint8Array(path){
	var retdat;
	retdat = Uint8Array.from(fs.readFileSync(path));
	log("!File opened");
	return retdat;
};

function splitUint8Array(array,pos){
	var ret = [new Uint8Array(pos), new Uint8Array(array.length-pos)];//set up arrays to be returned
	for(var i = 0; i<pos;i++){
		ret[0][i] = array[i];
	}
	for(var i = pos; i<array.length;i++){
		ret[1][i-pos] = array[i];
	}
	return ret;
};

function concatUint8Arrays(array1,array2){
	var ret = new Uint8Array(array1.length+array2.length);
	for(var i = 0; i<array1.length; i++) ret[i]=array1[i];
	for(var i = array1.length; i<array1.length+array2.length; i++) ret[i] = array2[i-array1.length];
	return ret;
};










//███████████████████████████████████████████//AUDIO SECTION//███████████████████████████████████████████//

function setNumInUint8Array(array,value,pos,bytes,bigEndian){
	var holdBytes = [];
	var holdValue = 0;
	var maxVal = 1;
	if(isNotNum(value)) value = 0; //just a failsafe
	for(var i = 0; i<bytes; i++) maxVal*=256;
	if(value>maxVal/2) value = maxVal/2;	//these clip the values to ensure no funky business
	if(value<maxVal/-2) value = maxVal/-2;
	if(value<0) value+=maxVal; //this should make it work.	I pray it does
	value = round(value);
	for(var i = 0; i<bytes; i++){
		holdValue = value.mod(256);
		value = (value-holdValue)/256; //step through 8 bits at a time
		holdBytes.push(holdValue);
	}
	while(holdBytes.length){
		if(pos<0||pos>=array.length) break;
		array[pos] = holdBytes.shift();
		pos++;
	}
};

function getNumFromUint8Array(array,pos,bytes,signed,bigEndian){
	var holdNums = [];
	var ret = 0;
	var maxNum = 1;
	for(var i = pos; i<pos+bytes; i++){
		if(i<0||i>=array.length){
			holdNums.push(0);
			continue;
		}
		holdNums.push(array[i]);
	}
	if(signed){
		while(holdNums.length){
			ret = ret*256+holdNums.pop();//shift right (or is it left)
			maxNum *= 256;
		}
		if(ret>=maxNum/2) ret -= maxNum;
	}else{
		while(holdNums.length) ret = ret*256+holdNums.pop();//shift right (or is it left)
	}
	if(isNotNum(ret)) ret = 0;//just a failsafe
	return ret;
};

function splitUint8Array(array,pos){
	var ret = [new Uint8Array(pos), new Uint8Array(array.length-pos)];//set up arrays to be returned
	for(var i = 0; i<pos;i++){
		ret[0][i] = array[i];
	}
	for(var i = pos; i<array.length;i++){
		ret[1][i-pos] = array[i];
	}
	return ret;
};

function WAVRawToSampleArray(inData,channels,bytesPerSample){
	if(!channels>0) channels = 1;
	var ret = [];
	var holdChan = 0;
	for(var i = 0; i<channels; i++) ret.push([]); //push a new channel
	for(var i = 0; i<inData.length/bytesPerSample; i++){
		ret[holdChan].push(getNumFromUint8Array(inData,i*bytesPerSample,bytesPerSample,true));
		if(++holdChan>=channels) holdChan = 0; //loop through the channels
	}
	return ret; //returns 2d array
};

function SampleArrayToWAVRaw(inArray,bytesPerSample){
	var numChannels = inArray.length; //get channels
	var ret = new Uint8Array(inArray[0].length*bytesPerSample*numChannels);
	for(var i = 0; i<inArray[0].length; i++){//step sample by sample
		for(var k = 0; k<numChannels; k++){
			setNumInUint8Array(ret,inArray[k][i],(i*numChannels+k)*bytesPerSample,bytesPerSample);
		}
	}
	return ret;
};

function getSegmentSection(segment, start, length, vol){//measured in samples
	if(isNotNum(vol)) vol = 1; 
	var holdSeg = [];
	var numChannels = segment.length; //get num channels
	if(start < 0){
		length += start;
		start = 0; //if the start is before the actual start of the segment, move it to the start and keep the end in the same place
	}
	for(var i = 0; i<numChannels; i++) holdSeg.push([]); //add a channel to the out
	start = r(start);
	length = r(length);
	if(length+start>segment[0].length && start < segment[0].length) length -= (start+length)-segment[0].length;
	for(var k = 0; k<numChannels; k++){
		for(var i = start; i<start+length; i++){
			holdSeg[k].push(forceNum(segment[k][i])*vol);
		}
	}
	return holdSeg;
}

function generateSilentSegment(length, sampleRate, numChannels){
	if(typeof numChannels !== 'number') numChannels = 1;
	var ret = [];
	for(var i = 0; i<numChannels; i++) ret.push([]); //add a channel
	var numSamples = round(length*sampleRate);
	for(var i = 0; i < numSamples; i++){
		for(var k = 0; k<numChannels; k++){
			ret[k].push(0);
		}
	}
	return ret;
}

function generateEmptySegment(numChan){
	var ret = [];
	for(var i = 0; i < numChan; i++) ret.push([]); //push an empty channel;
	return ret;
}

function copySegment(segment){
	var ret = [];
	for(var i = 0; i < segment.length; i++) ret.push(segment[i].clone());
	return ret;
}
var cloneSegment = copySegment; //redundancy

function reverseSegment(segment){
	var ret = [];
	for(var i = 0; i<segment.length; i++) ret.push(segment[i].reverseSafe()); //add the channels and reverse them at the same time
	return ret;
}

function speedSegment(segment, factor, noSmooth){//sets the speed to 1/factor of that of the original
	var ret = [];
	var holdVal = 0;
	var holdCount = 0;
	var holdFac = factor;
	for(var k = 0; k<segment.length; k++){//loops once for each channel
		ret[k] = [];
		holdVal = 0;
		holdCount = 0;
		holdFac = factor;
		if(noSmooth){
			for(var i = 0; i<segment[k].length; i++){
				holdFac --;
				while(holdFac<=0){
					ret[k].push(segment[k][i]);
					holdFac+=factor;
				}
			}
		}else{
			for(var i = 0; i<segment[k].length; i++){
				holdVal += segment[k][i];
				holdCount++;
				holdFac--;
				if(holdFac<=0){
					while(holdFac<=0){
						ret[k].push(holdVal/holdCount);
						holdFac+=factor;
					}
					holdVal = 0;
					holdCount = 0;
				}
			}
		}
	}
	return ret;
}

function concatSegments(seg1,seg2){
	var ret = [];
	if(seg1.length !== seg2.length){
		log("!ERROR! concatSegments() was passed two segments with different numbers of channels");
		return [[]];
	}
	for(var k = 0; k < seg1.length; k++){
		ret[k] = [];
		for(var i = 0; i <seg1[k].length; i++){
			ret[k].push(seg1[k][i]);
		}
	}
	for(var k = 0; k < seg2.length; k++){
		for(var i = 0; i <seg2[k].length; i++){
			ret[k].push(seg2[k][i]);
		}
	}
	return ret;
}

function appendSegment(seg1,seg2,noSew){ //like concatSegments(), but faster maybe.  Modifies the original array
	if(seg1.length !== seg2.length){
		log("!ERROR! appendSegment() was passed two segments with different numbers of channels");
		return [[]];
	}
	var seam = seg1[0].length;
	for(var k = 0; k < seg1.length; k++){
		for(var i = 0; i < seg2[k].length; i++){
			seg1[k].push(seg2[k][i]);
		}			
	}
	if(!noSew) sewSegment(seg1,seam);
	return seam; //return the position of the seam
}

function sewSegment(seg,seam,smoothLevel){ //seam is a point in the segment measured in samples from the beginning
	if(isNotNum(smoothLevel) || smoothLevel < 0) smoothLevel = exportSet.smoothingRate;
	if(smoothLevel >= seam) smoothLevel = seam-1; //basically don't go out of bounds
	if(smoothLevel >= seg[0].length-seam) smoothLevel = seg[0].length-seam-1;
	for(var k = 0; k < seg.length; k++){
		var weight = 1;
		var totalweight = 0;
		var total = 0;
		var avg;
		for(var i = 0; i < smoothLevel; i++){
			weight = (smoothLevel-i)/smoothLevel;
			total += seg[k][seam+i]*weight;
			total += seg[k][seam-i-1]*weight;
			totalweight += weight*2;
		}//get the weighted average
		avg = total/totalweight;
		for(var i = 0; i < smoothLevel; i++){
			weight = (smoothLevel-i)/smoothLevel;
			seg[k][seam+i] = seg[k][seam+i]*(1-weight) + avg*weight;
			seg[k][seam-i-1] = seg[k][seam-i-1]*(1-weight) + avg*weight;
		}//apply weighted smoothing
	}
}

function depopSegment(inseg,sensitivity){
	if(sensitivity == undefined) sensitivity = exportSet.depoppingSensitivity;
	
	var remCount = 0;
	while(inseg.length.mod(numChan) !== 0) inseg.pop(); //make sure the number of samples is devisible by the number of audio channels
	
	for(var i = 0; i<inseg.length; i++) if(typeof inseg[i] !== 'number' || isNaN(inseg[i])) inseg[i] = 0;
	for(var i = numChan; i<inseg.length-numChan; i++){
		if(inseg[i] >= sensitivity*-1 && inseg[i] <= sensitivity){
			if(inseg[i-numChan].sign() == inseg[i+numChan].sign()){
				inseg[i] = (inseg[i-numChan] + inseg[i+numChan])/2; //average out the neighboring channels if sample is zero and both neighbors have the same sign
				dlog("$removed pop at segment @ "+round((i/numChan/sampleRate)*1000)/1000+"sec (channel "+(i.mod(numChan)+1)+")");
				remCount++;
			}
		}
	}
	log("!removed "+remCount+" pops");
}

function mp3toWAV(path){ //yeah, this module doesn't work.  Don't try to use it.
	if(path.toLowerCase().endsWith(".wav")) return path; //if it's already a wav, somehow, just pass it back
	if(!path.toLowerCase().endsWith(".mp3")){
		log("!ERROR! mp3toWAV() passed path of non-mp3 file ("+path+")");
		return path;
	}
	var path2 = path.splice(path.length-4,4,"")+".WAV";
	clog(typeof path+" "+typeof path2);
	var decoder = new Mp32Wav(path,"C:\\"); 
	var done = false;
	//try{
		decoder.exec(path);
	//}catch(e){
	//	log("!ERROR! Error occured when converting .mp3 to .wav; more information sent to console (ctrl+shift+i)");
	//	clog(e);
	//}
	return path2;
}//returns new path to WAV

function calcPlayTime(segment,sampleRate){
	if(typeof segment == 'number'){
		return truncate(segment/sampleRate); //if passed number of samples
	}else{
		return truncate(segment[0].length/sampleRate); //if passed segment
	}
}

function appendWithBlur(seg,tailSeg){ //should be passed a segment (2d float array) and a segWithLead
	if(seg.leadin !== undefined) seg = seg.data; //if passed a segWithLead, point to its .data
	var blurLength = tailSeg.leadin[0].length;
	if(blurLength > seg[0].length) blurLength = seg[0].length - 1; //if the blur length is longer than the first segment, set it to the length of the first segment
	var seam = appendSegment(seg,tailSeg.data,true);
	
	var leadinPos; //what position in the leadin pos we're reading from
	var ratio;
	for(var k = 0; k < seg.length; k++){ //step through the channels
		leadinPos = 0;
		for(var i = 0; i < blurLength; i++){
			ratio = (blurLength-i)/blurLength; //make a gradient
			iratio = 1-ratio;
			seg[k][i+seam-blurLength] = seg[k][i+seam-blurLength]*ratio + tailSeg.leadin[k][leadinPos++]*iratio; //do the blur
		}
	}
}

class segWithLead { //basically just two segments, with the first being the main segment, and the second being a small segment leading into it
	constructor(segment, start, length, factor, blurLength){ //pass it a source segment, the start & length of the section you want to take, and how long the leadin should be.
		if(isNotNum(blurLength)) blurLength = exportSet.blurLength; //get default if undef
		if(isNotNum(factor)) factor = 1; //default to 1
		if(isNum(length)){ //if passed (most) all arguments
			var reversed = false;
			
			if(length < 0){ // if length is negative, it means segment is reversed
				length *= -1;
				reversed = true;
			}
			if(length == 0){
				start = 0;
				length = segment[0].length; //if input length is set to zero, just get the whole track
			}
			this.data = [];
			this.leadin = [];
			this.data = speedSegment(getSegmentSection(segment,start,length),factor); //get the data
			if(!reversed){
				this.leadin = speedSegment(getSegmentSection(segment, start-blurLength*factor, blurLength*factor),factor); //get the leadin
			}else{
				this.data = reverseSegment(this.data);
				this.leadin = reverseSegment(speedSegment(getSegmentSection(segment, start+length, blurLength*2),factor)); //get the leadin
			}
		}else{
			if(typeof segment == 'object'){
				if(segment.leadin !== undefined){ //if passed another segWithLead
					this.data = cloneSegment(segment.data);
					this.leadin = cloneSegment(segment.leadin);
				}else{ //if just passed a segment
					this.data = cloneSegment(segment);
					this.leadin = generateEmptySegment(segment.length);
				}
			}
		}
	}
}

class WAVFile {
	constructor(inUint8Array){//give it raw WAV data
		if(inUint8Array == undefined){
			this.header = new Uint8Array(44);
			this.data = [[]];
		}else{
			var holdDat = splitUint8Array(inUint8Array,44);
			this.header = holdDat[0];
			this.data = WAVRawToSampleArray(holdDat[1],this.getNumChannels(),this.getBytesPerSample());
		}
	}
	copyFrom(inWAVObj){
		this.copyHeader(inWAVObj);
		this.data = [];
		for(var i = 0; i<inWAVObj.data.length; i++) this.data.push([]);//push a new channel
		for(var i = 0; i < inWAVObj.data[0].length; i++){
			for(var k = 0; k<this.data.length; k++) this.data[k][i] = inWAVObj.data[k][i]; //copy data
		}
	}
	copyHeader(inWAVObj){
		for(var i = 0; i < 44; i++) this.header[i] = inWAVObj.header[i]; //copy header
	}
	saveToJSON(fileName){
		fs.writeFile(fileName, JSON.stringify({header:this.header, data:this.data}), () => {log("!JSON file saved")});
	}
	loadFromJSON(fileName){
		var fileData = JSON.parse(fs.readFileSync(fileName));
		this.copyHeader(fileData); //copy header
		this.data = fileData.data;
		this.updateSizeInHeaderToReflectData();
	}
	getBytesPerSample(){
		return getNumFromUint8Array(this.header,34,2)/8;
	}
	getNumChannels(){
		return getNumFromUint8Array(this.header,22,2);
	}
	getDataAsUint8Array(){
		return SampleArrayToWAVRaw(this.data,this.getBytesPerSample());
	}
	getSampleRate(){
		return getNumFromUint8Array(this.header,24,4);
	}
	setSampleRate(inRate){
		setNumInUint8Array(this.header,inRate,24,4);//sample rate value
		setNumInUint8Array(this.header,inRate*this.getNumChannels()*this.getBytesPerSample(),28,4);//byte rate
	}
	getLengthInSegments(){
		return this.data[0].length;
	}
	updateSizeInHeaderToReflectData(){
		var totalLength = 0;
		for(var i = 0; i<this.data.length; i++) totalLength+=this.data[i].length; //get the lengths of all the data channels
		setNumInUint8Array(this.header,totalLength*this.getBytesPerSample(),40,4);//"data" chunk
		setNumInUint8Array(this.header,totalLength*this.getBytesPerSample()+36,4,4);//size in header
	}
	getSegment(start, length){//measured in samples
		return getSegmentSection(this.data, start, length, this.getSampleRate());
	}
	getSize(){
		this.updateSizeInHeaderToReflectData();
		return getNumFromUint8Array(this.header,40,4); //return the size in the header
	}
	saveToFile(path,func){
		if(typeof func == 'function'){
			log(">Saving file \""+path+"\"...");
			this.updateSizeInHeaderToReflectData();
			fs.writeFile(path, concatUint8Arrays(this.header,this.getDataAsUint8Array()), func);
		}else{
			log(">Saving file \""+path+"\"...");
			this.updateSizeInHeaderToReflectData();
			fs.writeFile(path, concatUint8Arrays(this.header,this.getDataAsUint8Array()), function(err) {
				if(err) {
					return console.log(err);
				}
				log("!File saved");
			});
		}
	}
};













//███████████████████████████████████████████//SKIPJACKER SECTION//███████████████████████████████████████████//

function skipjack(audio,inRules){
	var ret = generateEmptySegment(audio.length);
	var holdRule;
	var holdSamples;
	for(var i = 0; i < inRules.length; i++){
		holdRule = inRules[i];
		if(!holdRule.autoLabel) log(">skipjacking "+holdRule.label+"...");
		holdSamples = new sampleBundle(holdRule.samples);
		holdSamples.mixSamples(audio,ret,holdRule.start,holdRule.length,holdRule.pattern,holdRule.factor,1);
	}
	log("!Finished skipjacking track");
	if(exportSet.finalSpeedFactor != 1){
		log(">Speed adjusting final track...");
		ret = speedSegment(ret,exportSet.finalSpeedFactor);
	}
	log("$Final track playtime is "+calcPlayTime(ret,inWAV.getSampleRate())+" sec");
	return ret;
}

class sampleListing{
	constructor(label,portion){
		if(typeof label == 'object'){//check if it was pased a sampleListing object
			if(label.label !== undefined){
				this.label = label.label;
				this.portion = label.portion;
				return;
			}
		}
		if(portion == undefined && typeof label == 'string'){ //if portion is undefined, it assumes you're passing it a sample-defining string (just a comma-separated letter and number);
			var hold = label.split(",");
			label = hold[0].charAt(0);
			portion = pFloat(hold[1]);
			if(portion > 1) portion = 1/portion; //fractions time
		}
		if(typeof label !== 'string'){
			label = "F";
			log("!ERROR! \""+label+"\"is an invalid sample label\n$label is not a string\n>defaulting label name to \"F\"");
		}
		if(label.toLowerCase() == label.toUpperCase){
			label = "F";
			log("!ERROR! \""+label+"\"is an invalid sample label\n$label is case-invariant\n>defaulting label name to \"F\"");
		}
		label = label.toUpperCase();
		if(isNotNum(portion)) portion = 1;
		this.label = label;
		this.portion = portion;
	}
}

class audioSample{ //like a normal sampleListing, but meant to hold audio
	constructor(inSampleListing){
		this.label = inSampleListing.label;
		this.portion = inSampleListing.portion;
		this.forwardSegment = Object;
		this.backwardSegment = Object; //both intended to be segWithLeads
	}
}

class sampleBundle{ //like a normal sampleListing, but many of them, with added functionality
	constructor(inSamples){//pass it a sampleListing array
		this.samples = [];
		for(var i = 0; i < inSamples.length; i++) this.samples.push(new sampleListing(inSamples[i]));
		var offset = 0;
		for(var i = 0; i < this.samples.length; i++){
			this.samples[i].offset = offset;
			offset += this.samples[i].portion; //calculate the starts of all the segments (measured in portion of the whole)
		}
	}
	mixSamples(inSeg,outSeg,start,length,pattern,factor,expectedRatio){ //inSeg is source audio, outSeg is output audio being built.  Start and length are of the rule these samples are of
		if(typeof pattern !== 'string'){
			log("!ERROR! sampleBundle.mixSamples() passed non-string as pattern ("+pattern+")\n$returning empty segment");
			return [];
		}
		var samples = this.samples;
		var numChan = inSeg.length; //get num channels
		var labels = pattern.split("");
		var endLength = 0;
		var holdStart, holdLength, holdLeadSeg;
		for(var i = 0; i < labels.length; i++){
			for(var q = 0; q < samples.length; q++){
				if(samples[q].label == labels[i].toUpperCase()){
					if(samples[q].label == labels[i]){//forwards
						var holdStart = samples[q].offset*length+start; //start of sample
						var holdLength = samples[q].portion*length; //length of sample
						holdLeadSeg = new segWithLead(inSeg,holdStart,holdLength,factor);
						appendWithBlur(outSeg,holdLeadSeg);
					}else{//backwards
						var holdStart = samples[q].offset*length+start; //start of sample
						var holdLength = samples[q].portion*length; //length of sample
						holdLeadSeg = new segWithLead(inSeg,holdStart,holdLength*-1,factor);
						appendWithBlur(outSeg,holdLeadSeg);
					}
					endLength+=samples[q].portion;
					break;
				}
			}
		}
		if(truncate(endLength/factor) !== expectedRatio) log("!WARNING! segment sample/playtime ratio does not meet desired ratio\n$"+truncate(endLength/factor)+"/1 vs "+expectedRatio+"/1");
	}
}

function samplesStringToSamplesArray(inSamples){
	var ret = [];
	if(typeof inSamples !== 'string'){
		log("!ERROR! samplesStringToSamplesArray() passed non-string\n$function was passed a "+typeof inSamples+"\n>defaulting to empty sample array");
		return ret;
	}
	inSamples = inSamples.replace(/ |\r|\t/g,'').replace(/█|\||;|\/|\n/g,":").split(":");
	for(var i = 0; i<inSamples.length; i++){
		if(inSamples[i].indexOf(",")==-1) inSamples[i] = inSamples[i].splice(1,0,","); //add a comma if it ain't there
		if(inSamples[i] == "") continue;
		ret.push(new sampleListing(inSamples[i]));
	}
	return ret;
}

function samplesArrayToSamplesString(inSamples){
	var say = "";
	for(var i = 0; i < inSamples.length; i++) if(inSamples[i].label !== "") say = say+inSamples[i].label+truncate(1/inSamples[i].portion)+"█";
	return say;
}

class rule {
	constructor(start, length, volume, factor, samples, pattern){
		if(typeof start == 'object'){
			if(typeof start.start == 'number'){//if passed an object with a structure akin to the rule class, it will clone it
				for(var k in start) this[k]=start[k];
				if(typeof this.samples == 'object'){
					var holdArray = this.samples;
					this.samples = [];
					for(var i = 0; i < holdArray.length; i++){
						this.samples.push(new sampleListing(holdArray[i])); //basically just clones each and converts them to sampleListings (even if they were already)
					}
				}
				return;
			}
		}
		if(typeof samples == 'string') samples = samplesStringToSamplesArray(samples); //if passed a sample string, turn it into a samples array
		if(typeof samples !== 'object') samples = [];
		this.start = start; //measured in samples
		this.length = length; //also measured in samples
		this.end = start+length; //still measured in samples
		this.volume = volume;
		this.samples = samples;
		this.pattern = pattern;
		this.factor = factor;
		this.autoLabel = true;
		this.label = "#0";
		this.r = 255;
		this.g = 0;
		this.b = 0;
	}
	getEnd(){
		return this.start+this.length;
	}
	addSample(l,p){
		this.samples.push(new sampleListing(l,p));
	}
	getSampleIndexByLabel(label){
		if(typeof label !== 'string'){
			log("!ERROR! rule.getSampleIndexByLabel() passed non-string ("+label+")\n>returning -1 as a failsafe");
			return -1;
		}
		label = label.charAt(0).toUpperCase(); //get first char and make it uppercase
		for(var i = 0; i < this.samples.length; i++){ if(label == this.samples[i].label) return i; }
		return -1; //nothing found
	}
	getSampleByLabel(label){
		var holdIndex = this.getSampleIndexByLabel(label);
		if(holdIndex < 0) return undefined; //tough luck, it's not there
		return this.samples[holdIndex];
	}
}

function bakeRuleArrayPositions(ruleArray){ //make sure they all line up end-to-end and don't overlap
	var holdPos = 0;
	for(var i = 0; i<ruleArray.length; i++){
		ruleArray[i].length = r(ruleArray[i].length); //should be a whole-number of samples
		ruleArray[i].start = holdPos;
		holdPos += ruleArray[i].length;
		ruleArray[i].end = holdPos-1;
		if(ruleArray[i].autoLabel) ruleArray[i].label = "#"+i; 
	}
}








//███████████████████████████████████████████//GRAPHICS SECTION//███████████████████████████████████████████//

function drawTri(ctx,x,y,size){
	ctx.beginPath();
	ctx.moveTo(x-size/2,y+size/2);
	ctx.lineTo(x+size/2,y+size/2);
	ctx.lineTo(x,y-size/2);
	ctx.fill();
}

function drawWarning(ctx,x,y){
	ctx.fillStyle = "yellow";
	drawTri(ctx,x,y,16);
	ctx.fillStyle = "red";
	drawTri(ctx,x,y,13);
	ctx.fillStyle = "yellow";
	drawTri(ctx,x,y,10);
}

function RGBToHex(R,G,B){
	return "#"+r(R.constr(0,255)).toString(16).pad(2)+r(G.constr(0,255)).toString(16).pad(2)+r(B.constr(0,255)).toString(16).pad(2);
}

class color{
	constructor(r,g,b){
		if(typeof r == 'object' && !isNotNum(r.r)){ //if you pass it another color
			this.r = r.r;
			this.g = r.g;
			this.b = r.b;
		}else{
			if(isNotNum(r)) r = 0;
			if(isNotNum(g)) g = r;
			if(isNotNum(b)) b = g;
			this.r = r;
			this.g = g;
			this.b = b;
		}
	}
	mult(x,nw){ //nw = no writeback
		if(typeof x !== 'number') x = 2;
		if(nw) return RGBToHex(this.r*x,this.g*x,this.b*x);
		this.r *= x;
		this.g *= x;
		this.b *= x;
		return this.toHexcode();
	}
	grey(x,nw){ //from 0 to 1
		if(typeof x !== 'number') x = 0.5;
		if(nw) return RGBToHex(128*x+this.r*(1-x),128*x+this.g*(1-x),128*x+this.b*(1-x));
		this.r = 128*x+this.r*(1-x);
		this.g = 128*x+this.g*(1-x);
		this.b = 128*x+this.b*(1-x);
		return this.toHexcode();
	}
	rand(x,nw){
		if(typeof x !== 'number') x = 1;
		if(nw) return RGBToHex(rng(0,255)*x+this.r*(1-x),rng(0,255)*x+this.g*(1-x),rng(0,255)*x+this.b*(1-x));
		this.r = rng(0,255)*x+this.r*(1-x);
		this.g = rng(0,255)*x+this.g*(1-x);
		this.b = rng(0,255)*x+this.b*(1-x);
		return this.toHexcode();
	}
	inv(nw){
		if(nw) return RGBToHex(255 - this.r,255 - this.g,255 - this.b);
		this.r = 255 - this.r;
		this.g = 255 - this.g;
		this.b = 255 - this.b;
		return this.toHexcode();
	}
	mix(inColor,ratio,nw){
		if(isNotNum(ratio)) ratio = 0;
		var hr = inColor.r*ratio + this.r*(1-ratio);
		var hg = inColor.g*ratio + this.g*(1-ratio);
		var hb = inColor.b*ratio + this.b*(1-ratio);
		if(nw) return RGBToHex(hr,hg,hb);
		this.r = hr;
		this.g = hg;
		this.b = hb;
		return this.x();
	}
	toHexcode(){
		return RGBToHex(this.r,this.g,this.b);
	}
	toString(){
		return RGBToHex(this.r,this.g,this.b);
	}
	toHex(){
		return RGBToHex(this.r,this.g,this.b);
	}
	x(){
		return RGBToHex(this.r,this.g,this.b);
	}
}

class canvasRenderer {
	constructor(inCanvas,inCanvas2){//give it the canvas object of the waveform canvas and the rule canvas
		this.waveCanObj = inCanvas;
		this.ruleCanObj = inCanvas2;
		if (inCanvas.getContext) {
			this.wctx = inCanvas.getContext('2d');
			var ctx = this.wctx;
			ctx._moveTo = ctx.moveTo;
			ctx.moveTo = function(x,y){ this._moveTo(r(x),r(y))};
			ctx._lineTo = ctx.lineTo;
			ctx.lineTo = function(x,y){ this._lineTo(r(x),r(y))};
			ctx._fillRect = ctx.fillRect;
			ctx.fillRect = function(x,y,w,h){ if(r(h) == 0) h = 1; this._fillRect(r(x),r(y),r(w),r(h))};
			ctx._strokeRect = ctx.strokeRect;
			ctx.strokeRect = function(x,y,w,h){ this._strokeRect(r(x),r(y),r(w),r(h))};
			ctx.vLine = function(x,y,h){ this.fillRect(x,y,1,h); };
		}else{
			log("!ERROR! Could not get context for wave canvas\n$You may need to restart the program");
			this.wctx = {};
		}
		if (inCanvas2.getContext) {
			this.rctx = inCanvas2.getContext('2d');
			var ctx = this.rctx;
			ctx._moveTo = ctx.moveTo;
			ctx.moveTo = function(x,y){ this._moveTo(r(x),r(y))};
			ctx._lineTo = ctx.lineTo;
			ctx.lineTo = function(x,y){ this._lineTo(r(x),r(y))};
			ctx._fillRect = ctx.fillRect;
			ctx.fillRect = function(x,y,w,h){ if(r(h) == 0) h = 1; this._fillRect(r(x),r(y),r(w),r(h))};
			ctx._strokeRect = ctx.strokeRect;
			ctx.strokeRect = function(x,y,w,h){ this._strokeRect(r(x),r(y),r(w),r(h))};
			ctx.vLine = function(x,y,h){ this.fillRect(x,y,1,h); };
		}else{
			log("!ERROR! Could not get context for rule canvas\n$You may need to restart the program");
			this.rctx = {};
		}
		this.lastStart = 0; //these are set in this.renderSound()
		this.lastSpp = 0;
		this.lastEnd = 0; //they are used by this.renderRule();
	}
	renderSound(segment,start,spp,bps,specificTrack){//spp is Samples Per Pix, start is measured in samples, bps is bytes per sample
		if(isNotNum(specificTrack)) specificTrack = -1;
		var numChan = segment.length;
		var to = 0; //track offset
		if(specificTrack >= 0){
			numChan = 1;
			to = specificTrack;
		}
		var ctx = this.wctx;
		var h = this.getWaveHeight(), w = this.getWidth();
		var maxVal = getMaxValueForNumberOfBytes(bps)/2; //div by two because they're signed
		start = r(start);
		spp = r(spp);
		
		this.lastStart = start;
		this.lastSpp = spp;
		this.lastEnd = start+w*spp; 
		
		var chanRendHeight = h/numChan;
		var m; //basically where the middle of the waveform image is
		
		var numH, numL, avgL, avgH, maxL, maxH, avg, count;
		var holdNum;
		var sampleStep;
		var col, col2, col3;
		
		this.clearWave();
		
		
		ctx.strokeStyle = "#000000";
		ctx.beginPath();
		ctx.moveTo(0, ruleHeadspace);
		ctx.lineTo(w, ruleHeadspace);
		ctx.stroke();
		
		if(spp <= 1){
			var thisPoint = 0, lastPoint = 0;
			for(var k = 0; k<numChan; k++){
				m = r((k+0.5)*chanRendHeight)+ruleHeadspace;
				ctx.fillStyle = new color(0,0,255);
				for(var i = 0; i<w; i++){ //do getWidth() pixels
					ctx.beginPath();
					thisPoint = (segment[k+to][i+start]/maxVal)*chanRendHeight/2;
					ctx.vLine(i,thisPoint+m,lastPoint-thisPoint);
					lastPoint = thisPoint;
				}
				ctx.lineWidth = 1;
				ctx.strokeStyle = "black";
				
				ctx.beginPath();
				ctx.moveTo(0, m);
				ctx.lineTo(w, m);
				ctx.stroke();
			}
		}else{
			var sampleStep;
			col = new color(0,0,255);
			col2 = new color(100,100,255);
			for(var k = 0; k<numChan; k++){
				m = r((k+0.5)*chanRendHeight)+ruleHeadspace;
				for(var i = 0; i < w; i++){ //do getWidth() pixels
					if(segment[k+to][i*spp+start] == undefined){ //end of the line
						ctx.fillStyle = new color(0);
						ctx.beginPath();
						ctx.vLine(i, m-(chanRendHeight/2),chanRendHeight);
						break;
					}
					numH = 0, numL = 0, avgL = 0, avgH = 0, maxL = maxVal, maxH = maxVal*-1, avg = 0, count = 0;
					sampleStep = 1;
					if(spp>=24) sampleStep = r(spp/24);
					
					for(var j = 0; j < spp; j+=sampleStep){
						holdNum = segment[k+to][i*spp+start+j]; 
						if(maxH < holdNum) maxH = holdNum;
						if(maxL > holdNum) maxL = holdNum;
						avg += holdNum;
						count++
					}
					avg/=count; //get average
					for(var j = 0; j < spp; j+=sampleStep){
						holdNum = segment[k+to][i*spp+start+j]; 
						if(holdNum < avg){
							numL++;
							avgL+=holdNum;
						}else{
							numH++;
							avgH+=holdNum;
						}
					}
					avgH/=numH;
					avgL/=numL;
					ctx.fillStyle = col;
					ctx.vLine(i,chanRendHeight*maxH/maxVal/2+m,chanRendHeight*(maxL-maxH)/maxVal/2);
					ctx.fillStyle = col2;
					ctx.vLine(i,chanRendHeight*avgH/maxVal/2+m,chanRendHeight*(avgL-avgH)/maxVal/2);
				}
				ctx.lineWidth = 1;
				ctx.strokeStyle = "black";
				
				ctx.beginPath();
				ctx.moveTo(0, m);
				ctx.lineTo(w, m);
				ctx.stroke();
			}
		}
	}
	renderRules(inRuleArray,selection){
		this.clearRule();
		bakeRuleArrayPositions(inRuleArray); //we wanna make sure there's no funny business
		for(var i = 0; i < inRuleArray.length; i++) this.renderRule(inRuleArray,i,selection);
		this.renderLabels(inRuleArray);
	}
	renderLabels(inRuleArray){
		for(var i = 0; i < inRuleArray.length; i++){
			var holdRule = inRuleArray[i];
			if(holdRule.autoLabel) continue; //the rule has no label
			
			var ctx = this.rctx;
			var holdWidth = holdRule.label.estWidth(canvasFontSize/2)+6;
			var leftEdge = r((holdRule.start-this.lastStart)/this.lastSpp);
			
			if(leftEdge < this.getWidth() || leftEdge+holdWidth > 0){
				ctx.font = "bold "+(canvasFontSize/2)+"px lucida console";
				ctx.textAlign = "center";
				ctx.fillStyle = new color(255);
				ctx.strokeStyle = new color(0);
				ctx.strokeRect(leftEdge,0,holdWidth,canvasFontSize/2+2);
				ctx.fillRect(leftEdge,0,holdWidth,canvasFontSize/2+2);
				ctx.fillStyle = new color(0);
				ctx.fillText(holdRule.label,leftEdge+holdWidth/2,canvasFontSize/2/2+4);
			}
		}
	}
	renderRule(inRuleArray,index,selection){
		var selected = selection.selected(index);
		var holdRule = inRuleArray[index];
		var ctx = this.rctx;
		
		ctx.font = "bold "+canvasFontSize+"px lucida console";
		
		var col = new color(holdRule.r,holdRule.g,holdRule.b), col2, col3; //colors!
		if(selected) col.mix(new color(255,255,0),0.7);
		if(index.mod(2) == 0) col.mult(0.8);
		var ruleWidth, leftEdge, rightEdge, innerWidth, holdLeft, barWidth;
		var holdNum, holdLabels, holdSample;
		var say = "";
		
		if(holdRule == undefined){
			log("!ERROR! rule index out of bounds in canvasRenderer.renderRule()\$attempt to access rule "+index+" of "+inRuleArray.length);
			return;
		}
		
		
		if(holdRule.end > this.lastStart || this.start < this.lastEnd){
			ruleWidth = r(holdRule.length/this.lastSpp); //find the width to render
			leftEdge = r((holdRule.start-this.lastStart)/this.lastSpp);
			rightEdge = leftEdge + ruleWidth;
			
			ctx.fillStyle = col.toHexcode();
			ctx.strokeStyle = col.toHexcode();
			ctx.fillRect(leftEdge,0,ruleWidth,ruleHeadspace);
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(leftEdge+1,ruleHeadspace);
			ctx.lineTo(leftEdge+1,ruleHeadspace+this.getWaveHeight());
			ctx.stroke();
			ctx.fillRect(leftEdge,ruleHeadspace+this.getWaveHeight(),ruleWidth,ruleBottomspace);
			ctx.beginPath();
			ctx.moveTo(rightEdge-1,ruleHeadspace+this.getWaveHeight());
			ctx.lineTo(rightEdge-1,ruleHeadspace);
			ctx.stroke();
			ctx.lineWidth = 1;
			
			//draw rule stats
			ctx.textAlign = "left";
			ctx.fillStyle = col.inv(true);
			ctx.font = "bold "+(canvasFontSize/2)+"px lucida console";
			say = "#"+index;
			if(say.estWidth(canvasFontSize/2) < ruleWidth-19) ctx.fillText(say, leftEdge+2, 12); //only render if it can fit
			say = "S: "+truncate(holdRule.start/inWAV.getSampleRate()).pad(6,'0',true)+" █F: "+truncate(holdRule.factor);
			if(say.estWidth(canvasFontSize/2) < ruleWidth-19) ctx.fillText(say, leftEdge+2, 24); //only render if it can fit
			say = "L: "+truncate(holdRule.length/inWAV.getSampleRate()).pad(6,'0',true)+" █V: "+truncate(holdRule.volume);
			if(say.estWidth(canvasFontSize/2) < ruleWidth-19) ctx.fillText(say, leftEdge+2, 36); //only render if it can fit
			
			
			
			
			col2 = new color(col); //copy the color
			ctx.strokeStyle = col2.toHex(); 
			col2.grey(0.3);
			ctx.textAlign = "center";
			ctx.font = "bold "+canvasFontSize+"px lucida console";
			
			holdLeft = leftEdge+2;
			innerWidth = ruleWidth-4;
			for(var i = 0; i < holdRule.samples.length; i++){ //rendering the samples
				if(i.mod(2) == 0){ col2.mult(0.8);
				}else{ col2.mult(1/0.8); }
				col3 = new color(col2);
				col3.inv(); //col3 is just col2 but inverted
				ctx.fillStyle = col2.toHex();
				holdNum = holdRule.samples[i].portion*innerWidth;
				
				ctx.fillRect(holdLeft,ruleHeadspace-ruleSampleLabelSpace,holdNum,ruleSampleLabelSpace); //draw the label box
				
				ctx.fillStyle = col3.toHex()
				if(holdRule.samples[i].label.estWidth() < holdNum) ctx.fillText(holdRule.samples[i].label, holdLeft+holdNum/2, ruleHeadspace-1); //only render if it can fit
				
				
				//if(i !== 0){ //if it's not the first sample, draw a thin vertical line
					col3 = new color(col2)
					col3.r = 255;
					ctx.fillStyle = col3;
					ctx.vLine(holdLeft,ruleHeadspace+1,this.getWaveHeight());
				//}
				holdLeft += holdNum; //advance to the right
			}
			col2 = new color(col); //copy the color
			//col2.r = 255;//red as can be
			col2.grey(0.4);
			
			ctx.font = "bold "+(canvasFontSize-4)+"px lucida console";
			
			holdLeft = leftEdge+2;
			
			holdLabels = holdRule.pattern.split(""); //render the pattern
			for(var i = 0; i < holdLabels.length; i++){
				if(i.mod(2) == 0){ col2.mult(0.8);
				}else{ col2.mult(1/0.8); }
				
				holdSample = holdRule.getSampleByLabel(holdLabels[i]);
				if(holdSample){
					holdNum = holdSample.portion*innerWidth/(holdRule.factor*exportSet.finalSpeedFactor);
					ctx.fillStyle = col2.x();
				}else{
					holdNum = holdRule.samples[0].portion*innerWidth/(holdRule.factor*exportSet.finalSpeedFactor); //uh oh, this sample isn't listed, default to the first sample and hope it exists;
					drawWarning(ctx,holdLeft+holdNum/2,ruleHeadspace+this.getWaveHeight()-9);
					ctx.fillStyle = col2.rand(0.75,true);
				}
				ctx.fillRect(holdLeft,ruleHeadspace+this.getWaveHeight()+1,holdNum,ruleBottomspace-1); //draw the pattern sample label box
				
				ctx.fillStyle = col2.inv(true);
				if(holdLabels[i].estWidth() < holdNum) ctx.fillText(holdLabels[i], holdLeft+holdNum/2, ruleHeadspace+this.getWaveHeight()+ruleBottomspace-7); //only render if it can fit
				holdLeft+=holdNum;
			}
			if(holdLeft > rightEdge){drawWarning(ctx,rightEdge-9,9);}
			if(holdLeft < rightEdge-5){
				drawWarning(ctx,rightEdge-9,9);
				ctx.fillStyle = col2.rand(0.75,true);
				ctx.fillRect(holdLeft,ruleHeadspace+this.getWaveHeight()+1,rightEdge-holdLeft,ruleBottomspace-1); //fill in the rest of the pattern with random
				drawWarning(ctx,holdLeft+(rightEdge-holdLeft)/2,ruleHeadspace+this.getWaveHeight()+9);
			}
			
			//grabber/dragger
			col3 = new color(1);
			if(!(selected && selection.isContinuous())){
				ctx.fillStyle = col3.mult(64,true);
				ctx.strokeStyle = col3.mult(128);
				ctx.fillRect(leftEdge+6,ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace*0.75,innerWidth-8,ruleDraggerSpace/2);
				ctx.strokeRect(leftEdge+6,ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace*0.75,innerWidth-8,ruleDraggerSpace/2);
			}
		}else{
			//the rule is out of frame, what do you want?
		}
		if(selection.numSelected() > 0 && selection.isContinuous()){
			barWidth = r(selection.getLength()/this.lastSpp); //find the width to render
			leftEdge = r((selection.getStart()-this.lastStart)/this.lastSpp);
			rightEdge = leftEdge + barWidth;
			
			col = new color(1);
			ctx.fillStyle = col.mult(200,true);
			ctx.strokeStyle = col.mult(240,true);
			ctx.fillRect(leftEdge+6,ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace*0.75,barWidth-12,ruleDraggerSpace/2);
			ctx.strokeRect(leftEdge+6,ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace*0.75,barWidth-12,ruleDraggerSpace/2);
			
			ctx.fillStyle = col.mult(220,true);
			ctx.strokeStyle = col.mult(250,true);
			ctx.beginPath();
			ctx.moveTo(rightEdge-10,ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace/2);
			ctx.lineTo(rightEdge,ruleHeadspace-ruleSampleLabelSpace+2);
			ctx.lineTo(rightEdge,ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace-2);
			ctx.fill();
			ctx.stroke();
		}
		ctx.lineWidth = 1;
	}
	clearWave(){
		this.wctx.clearRect(0,0,this.getWidth(),this.getHeight());
	}
	clearRule(){
		this.rctx.clearRect(0,0,this.getWidth(),this.getHeight());
	}
	getWidth(){
		return this.waveCanObj.width;
	}
	getHeight(){
		return this.waveCanObj.height;
	}
	getWaveHeight(){
		return this.getHeight()-ruleHeadspace-measureBottomspace-ruleBottomspace;
	}
	setWidth(inWidth){
		this.waveCanObj.width = inWidth;
		this.ruleCanObj.width = inWidth;
	}
};










//███████████████████████████████████████████//RENDER FUNCTIONS//███████████████████████████████████████████//

function renderWAVCanvas(){
	if(inWAV.getLengthInSegments()){
		waveCan.renderSound(inWAV.data,rendSet.start*inWAV.getSampleRate(),rendSet.spp,inWAV.getBytesPerSample(),rendSet.viewingChan);
	}
}

function renderRules(){
	if(inWAV.getLengthInSegments()){
		waveCan.renderRules(rules,selection);
	}
}

function renderViewStats(){
	document.getElementById('viewStats').innerHTML = "chan "+rendSet.viewingChan+"█SPP:"+rendSet.spp+"█"+truncate(rendSet.start)+" to "+truncate(rendSet.start+(waveCan.getWidth()*rendSet.spp/inWAV.getSampleRate()))+" sec█mouse @ "+mouse.overSample+" ("+truncate(mouse.overSample/inWAV.getSampleRate())+" sec)█mouse pos: ("+mouse.x+","+mouse.y+")█"+rules.length+" total rules█clipboard has "+clipboard.length+" rules█undo stack: "+project.historyPosition+" -> "+project.ruleHistoryStack.length+"/"+project.maxHistorySize+"█";
}

function reloadCanvas(){
	waveCan.setWidth(document.getElementById('canvHolder').clientWidth);
	renderAll();
}

function renderAll(){
	renderWAVCanvas();
	renderRules();
	renderViewStats();
}










//███████████████████████████████████████████//DOM/SCRIPT INTERACTION SECTION//███████████████████████████████████████████//

function loadNewWAVFile(){
	var inFile = document.getElementById('inPathWAVText').value;
	//if(inFile.toLowerCase().endsWith(".mp3")) inFile = mp3toWAV(inFile); //convert to WAV
	
	try{
		log(">Looking for preformatted JSON file");
		if(fs.existsSync(inFile+".json")){
			log("!Found prefomatted JSON audio file");
			log(">Opening JSON file \""+inFile+".JSON\"...");
			inWAV.copyFrom(new WAVFile());
			inWAV.loadFromJSON(inFile+".JSON");
			outWAV = new WAVFile();
		}else{
			log("!No preformatted JSON file of audio detected");
			log(">Opening source WAV file \""+inFile+"\"...");
			
			inWAV.copyFrom(new WAVFile(fileToUint8Array(inFile)));
			outWAV = new WAVFile();
			log(">Saving audio data to .JSON for faster future access...");
			inWAV.saveToJSON(inFile+".JSON");
			log("!Saving preformatted JSON as "+inFile+".JSON in the background");
		}
		log("!Done fetching audio data");
		outWAV.copyHeader(inWAV);
		outWAV.updateSizeInHeaderToReflectData();
		setOffset(0,true);
		setSPP(1024);
		selection.clear();
	}catch(e){
		log("!ERROR! Failed loading file");
		log("$more information sent to console (crtl+shift+i");
		console.error(e);
	}
}

function saveRuleFile(){
	var outFile = document.getElementById('outPathRuleText').value;
	log(">Saving rule file...");
	try{
		if(outFile.toLowerCase().indexOf(".rule") == -1) log("!WARNING! Saved file does not have a '.rule' file extension");
		saveRuleListToFile(outFile,rules);
		log("!File saved as "+outFile);
	}catch(e){
		log("!ERROR! Failed saving file");
		log("$more information sent to console (crtl+shift+i");
		console.error(e);
	}
}

function loadRuleFile(){
	var inFile = document.getElementById('inPathRuleText').value;
	log(">Loading rule file...");
	try{
		if(inFile.toLowerCase().indexOf(".rule") == -1) log("!WARNING! Loaded file does not have a '.rule' file extension");
		rules = loadRulesFromFile(inFile);
		selection.rules = rules;
		project.rules = rules; //gotta update these pointers
		log("!File "+inFile+" loaded");
		selection.clear(); //don't want to be selecting a rule that doesn't exist anymore
		renderRules();
	}catch(e){
		log("!ERROR! Failed loading file");
		log("$more information sent to console (crtl+shift+i");
		console.error(e);
	}
}

function exportWAV(){
	var outFile = document.getElementById('outPathWAVText').value;
	if(inFile.toLowerCase().indexOf(".wav") == -1) log("!WARNING! Exported file does not have a '.wav' file extension");
	outWAV.copyHeader(inWAV);
	outWAV.data = skipjack(inWAV.data,rules);
	outWAV.saveToFile(outFile);
	try{
		log("!Audio compiled and exported as "+outFile);
	}catch(e){
		log("!ERROR! Failed exporting file");
		log("$more information sent to console (crtl+shift+i");
		console.error(e);
	}
}

function setSPP(val,noRend){
	if(val < 1) val = 1;
	val = r(val);//round it
	document.getElementById('sppNum').value = truncate(val);
	rendSet.spp = val;
	if(!noRend) renderAll();
}

function setOffset(val,noRend){
	if(val < 0) val = 0;
	document.getElementById('offsetNum').value = truncate(val);
	rendSet.start = val;
	if(!noRend) renderAll();
}

function setSamples(sampleStr){
	var holdRules = selection.getAllSelectedRules();
	for(var i = 0; i < holdRules.length; i++) holdRules[i].samples = samplesStringToSamplesArray(sampleStr);
	renderRules();
}

function getSamples(){
	var holdRule = selection.getFirstRule();
	if(holdRule !== undefined) return samplesArrayToSamplesString(holdRule.samples);
	log("!nothing selected\$returning empty string");
	return "";
}

function setPattern(pattern){
	var holdRules = selection.getAllSelectedRules();
	for(var i = 0; i < holdRules.length; i++) holdRules[i].pattern = pattern;
	renderRules();
}

function getPattern(){
	var holdRule = selection.getFirstRule();
	if(holdRule !== undefined) return holdRule.pattern;
	log("!nothing selected\$returning empty string");
	return "";
}

function setLabel(label){
	var holdRules = selection.getAllSelectedRules();
	for(var i = 0; i < holdRules.length; i++){
		if(label == "" || i > 0){
			holdRules[i].autoLabel = true;
		}else{
			holdRules[i].autoLabel = false;
			holdRules[i].label = label;
		}
	}
	bakeRuleArrayPositions(rules);
	renderRules();
}

function getLabel(){
	var holdRule = selection.getFirstRule();
	if(holdRule !== undefined){
		if(holdRule.autoLabel) return ""; //just the number if autolabel is on
		return holdRule.label;
	}
	log("!nothing selected\$returning empty string");
	return "";
}

function setColor(color){
	var holdRules = selection.getAllSelectedRules();
	var holdColors = color.split(",");
	holdColors[0] = forceNum(holdColors[0]); //r
	holdColors[1] = forceNum(holdColors[1]); //g
	holdColors[2] = forceNum(holdColors[2]); //b
	for(var i = 0; i < holdRules.length; i++){
		holdRules[i].r = holdColors[0];
		holdRules[i].g = holdColors[1];
		holdRules[i].b = holdColors[2];
	}
	renderRules();
}

function getColor(){
	var holdRule = selection.getFirstRule();
	if(holdRule !== undefined) return holdRule.r+","+holdRule.g+","+holdRule.b;
	log("!nothing selected\$returning red");
	return "255,0,0";
}

function setLength(length){
	length = forceNum(length);
	var holdRules = selection.getAllSelectedRules();
	for(var i = 0; i < holdRules.length; i++) holdRules[i].length = length*inWAV.getSampleRate();
	bakeRuleArrayPositions(rules);
	renderRules();
}

function getLength(){
	var holdRule = selection.getFirstRule();
	if(holdRule !== undefined) return holdRule.length/inWAV.getSampleRate();
	log("!nothing selected\$returning 1");
	return 1;
}

function getLengthAvg(){
	var holdRules = selection.getAllSelectedRules();
	var holdVal;
	if(holdRules.length){
		holdVal = 0;
		for(var i = 0; i < holdRules.length; i++) holdVal+=holdRules[i].length;
		return holdVal/holdRules.length/inWAV.getSampleRate();
	}
	log("!nothing selected\$returning 1");
	return 1;
}

function setFactor(factor){
	factor = forceNum(factor);
	var holdRules = selection.getAllSelectedRules();
	for(var i = 0; i < holdRules.length; i++) holdRules[i].factor = factor;
	bakeRuleArrayPositions(rules);
	renderRules();
}

function getFactor(){
	var holdRule = selection.getFirstRule();
	if(holdRule !== undefined) return holdRule.factor;
	log("!nothing selected\$returning 2");
	return 2;
}

function getFactorAvg(){
	var holdRules = selection.getAllSelectedRules();
	var holdVal;
	if(holdRules.length){
		holdVal = 0;
		for(var i = 0; i < holdRules.length; i++) holdVal+=holdRules[i].factor;
		return r(holdVal/holdRules.length);
	}
	log("!nothing selected\$returning 2");
	return 2;
}

function setVolume(volume){
	volume = forceNum(volume);
	var holdRules = selection.getAllSelectedRules();
	for(var i = 0; i < holdRules.length; i++) holdRules[i].volume = volume;
	bakeRuleArrayPositions(rules);
	renderRules();
}

function getVolume(){
	var holdRule = selection.getFirstRule();
	if(holdRule !== undefined) return holdRule.volume;
	log("!nothing selected\$returning 1");
	return 1;
}

function getVolumeAvg(){
	var holdRules = selection.getAllSelectedRules();
	var holdVal;
	if(holdRules.length){
		holdVal = 0;
		for(var i = 0; i < holdRules.length; i++) holdVal+=holdRules[i].volume;
		return r(holdVal/holdRules.length);
	}
	log("!nothing selected\$returning 1");
	return 1;
}

function selectRuleUnderCursor(){
	holdVal = project.getRuleIndexByStartPos(mouse.overSampleRaw);
	if(holdVal > -1){
		selection.select(holdVal);
		renderRules();
	}
}

function deselectRuleUnderCursor(){
	holdVal = project.getRuleIndexByStartPos(mouse.overSampleRaw);
	if(holdVal > -1){
		selection.deselect(holdVal);
		renderRules();
	}
}

function toggleRuleUnderCursor(){
	holdVal = project.getRuleIndexByStartPos(mouse.overSampleRaw);
	var ret = true;
	if(holdVal > -1){
		ret = selection.flipSelection(holdVal);
		renderRules();
	}
	return ret;
}

function skipjackSelected(){
	var holdRules = selection.getAllSelectedRules();
	return skipjack(inWAV.data,holdRules);
}

function setPlaybackButtons(boolie){
	$(function(){
		$(".playbackButton").attr("disabled", boolie);
	});
}
function setStopButton(boolie){
	$("#stopButton").attr("disabled", boolie);
}

function createRules(samples,pattern,length,factor,volume,num){
	if(isNotNum(num)) num = 1;
	var pos = selection.getLastRuleIndex()+1;
	if(pos == undefined) pos = rules.length;
	for(var i = 0; i < num; i++){
		project.addRule(new rule(0,length,volume,factor,samples,pattern),pos);
		pos++;
	}
	bakeRuleArrayPositions(rules);
	renderRules();
}

function duplicateSelected(){
	pushRuleState();
	if(selection.numSelected()){
		var holdRules = cloneRulesArray(selection.getAllSelectedRules());
		project.addRuleArray(holdRules,selection.getLastRuleIndex()+1);
		renderRules();
	}else{
		log("!Cannot duplicate selection; nothing selected");
	}
	return false;
};

function deleteSelected(){
	pushRuleState();
	if(selection.numSelected()){
		var holdRules = selection.getAllSelectedIndexes();
		project.delRuleArray(holdRules);
		renderRules();
	}else{
		log("!Cannot delete selection; nothing selected");
	}
	return false;
};

function copyRules(){
	if(selection.numSelected()){
		clipboard = cloneRulesArray(selection.getAllSelectedRules());
		renderViewStats();
	}else{
		log("!Cannot copy selection; nothing selected");
	}
	return false;
};

function cutRules(){
	pushRuleState();
	if(selection.numSelected()){
		clipboard = cloneRulesArray(selection.getAllSelectedRules());
		deleteSelected();
		renderViewStats();
	}else{
		log("!Cannot cut selection; nothing selected");
	}
	return false;
};

function pasteRules(){
	pushRuleState();
	if(clipboard.length){
		var holdPos = selection.getLastRuleIndex();
		if(holdPos == -1) holdPos = rules.length;
		project.addRuleArray(clipboard,holdPos+1);
		renderRules();
	}else{
		log("!Clipboard is empty");
	}
	return false;
};

function newRule(){
	pushRuleState();
	holdVal = pFloat(document.getElementById('repeatNum').value);
	createRules(document.getElementById('samplesText').value,document.getElementById('patternText').value,pFloat(document.getElementById('lengthNum').value)*inWAV.getSampleRate(),pFloat(document.getElementById('factorNum').value),pFloat(document.getElementById('volumeNum').value),holdVal);
	return false;
}


function getAllProps(){
	document.getElementById('samplesText').value = getSamples();
	document.getElementById('patternText').value = getPattern();
	document.getElementById('lengthNum').value = getLength();
	document.getElementById('factorNum').value = getFactor();
	document.getElementById('volumeNum').value = getVolume();
	return false;
}

function setAllProps(){
	pushRuleState();
	setSamples(document.getElementById('samplesText').value);
	setPattern(document.getElementById('patternText').value);
	setLength(document.getElementById('lengthNum').value);
	setFactor(document.getElementById('factorNum').value);
	setVolume(document.getElementById('volumeNum').value);
	return false;
}

function getAllPropsAvg(){
	document.getElementById('lengthNum').value = getLengthAvg();
	document.getElementById('factorNum').value = getLengthAvg();
	document.getElementById('volumeNum').value = getVolumeAvg();
	return false;
}

function playInWAV(){
	if(!playingAudio){
		playingAudio = true;
		if(selection.numSelected() <= 0){
			log("!Nothing is selected, cannot play segment");
			return;
		}
		setPlaybackButtons(true);
		outWAV.copyHeader(inWAV);
		outWAV.data = getSegmentSection(inWAV.data,selection.getStart(),selection.getLength());
		outWAV.saveToFile('./temp.wav',function(e){
			if(e){
				return console.log(e);
			}
			log("!Temp file saved");
			setStopButton(false);
			log(">Loading temp file and starting playback...");
			player.play({path:"./temp.wav", sync: true, loop:true}).then(() => {
				log("!Playback started");
			});
		});
	}else{
		stopWAV();
	}
	return false;
}

function playOutWAV(){
	if(!playingAudio){
		playingAudio = true;
		if(selection.numSelected() <= 0){
			log("!Nothing is selected, cannot play segment");
			return;
		}
		setPlaybackButtons(true);
		outWAV.copyHeader(inWAV);
		outWAV.data = skipjackSelected();
		outWAV.saveToFile('./temp.wav',function(e){
			if(e){
				return console.log(e);
			}
			log("!Temp file saved");
			setStopButton(false);
			log(">Loading temp file and starting playback...");
			player.play({path:"./temp.wav", sync: true, loop:true}).then(() => {
				log("!Playback started");
			});
		});
	}else{
		stopWAV();
	}
	return false;
}

function stopWAV(){
	if(playingAudio){
		playingAudio = false;
		player.stop();
		log("!Playback stopped");
		setPlaybackButtons(false);
		setStopButton(true);
	}
	return false;
}

function changeChannelView(chan){
	if(isNotNum(chan)){
		if(++rendSet.viewingChan >= inWAV.getNumChannels()) rendSet.viewingChan = -1;
	}else{
		rendSet.viewingChan = chan;
	}
	renderWAVCanvas();
	renderViewStats();
	return false;
}

function pushRuleState(){
	project.pushRules();
	renderViewStats();
	return false;
}

function undo(){
	if(!project.undoRules()) log("!Out of undos; cannot undo any further");
	renderRules();
	renderViewStats();
	return false;
}

function redo(){
	if(!project.redoRules()) log("!Out of redos; cannot redo any further");
	renderRules();
	renderViewStats();
	return false;
}

function splitRule(ruleIndex,noBake){
	if(rules.inBounds(ruleIndex)){
		var isSelected = selection.isSelected(ruleIndex);
		rules[ruleIndex].length /= 2; //half the length
		project.addRule(new rule(rules[ruleIndex]),ruleIndex); //clone it and put it in
		if(isSelected) selection.select(ruleIndex); //make sure to select both, if the first was selected
		if(!noBake) bakeRuleArrayPositions(rules); //no funny business
	}else{
		log("!ERROR! splitRule() attempted to split a rule index which does not exist. ("+ruleIndex+" of "+rules.length-1+")");
	}
	return false;
}

function splitSelected(){
	var holdRules = selection.getAllSelectedIndexes();
	if(!holdRules.length){
		log("!Nothing is selected; could not split rule");
		return false;
	}
	project.pushRules();
	for(var i = holdRules.length-1; i > -1; i--) splitRule(holdRules[i],true);
	bakeRuleArrayPositions(rules);
	renderRules();
	return false;
}

function joinSelected(){
	if(selection.numSelected() < 2){
		log("!Not enough rules are selected; could not join");
		return false;
	}
	if(!selection.isContinuous()){
		log("!Selection is not continuous; could not join");
		return false;
	}
	project.pushRules();
	var holdRules = selection.getAllSelectedIndexes();
	var holdLength = 0;
	var nonHomogenous = false;
	for(var i = holdRules.length-1; i > 0; i--){ //we do this backwards so they delete in the right order
		holdLength += rules[holdRules[i]].length;
		if(rules[holdRules[i]].factor !== rules[holdRules[0]].factor || rules[holdRules[i]].pattern !== rules[holdRules[0]].pattern) nonHomogenous = true; 
		project.delRule(holdRules[i]);
	}
	rules[holdRules[0]].length += holdLength; //make it take up the whole width
	bakeRuleArrayPositions(rules);
	if(nonHomogenous) log("!Warning, selection was non-homogenous, some detail was lost");
	renderRules();
	return false;
}

function extendSelection(toIndex){
	if(toIndex == -1) return false;
	if(!rules.inBounds(toIndex)){
		log("!ERROR! extendSelection() passed out-of-bounds value ("+toIndex+" of [0,"+rules.length+"])");
		return false;
	}
	selection.selectRange(toIndex,selection.getFirstRuleIndex());
	selection.selectRange(toIndex,selection.getLastRuleIndex());
	renderRules();
}
















//███████████████████████████████████████████//INITIALIZATION SECTION//███████████████████████████████████████████//




window.addEventListener('DOMContentLoaded', () => {
	
	
	
	project = new projectClass();
	
	inWAV = project.WAVFile;
	rules = project.rules;
	selection = project.selection;
	
	rules.push(new rule(0,44100*4,1,2,"F,0.5;G,0.5","FGgG")); //make the first rule
	bakeRuleArrayPositions(rules);
	
	canvas = document.getElementById('waveformCanvas');
	canvas2 = document.getElementById('ruleCanvas');
	logBox = document.getElementById('logBox');
	
	waveCan = new canvasRenderer(canvas, canvas2); //get the canvas(es)
	
	
	const replaceText = (selector, text) => {
		const element = document.getElementById(selector)
		if (element) element.innerText = text
	}
/*
	for (const type of ['chrome', 'node', 'electron']) {
		replaceText(`${type}-version`, process.versions[type])
	}
*/
	reloadCanvas();
	window.addEventListener('resize', reloadCanvas);
	
	
	//███████████████████████████████████████████//BUTTON FUNCTIONS//███████████████████████████████████████████//
	
	document.getElementById('inWAVPathBrowse').addEventListener("click", function(){
		dialog.showOpenDialog({
			properties: ['openFile'],
			filters:[
				{name: ".WAV or .MP3 File", extensions:["wav","mp3"]},
				{name: "any", extensions:["*"]}]
		}).then(result => {
			if(result.canceled || result.filePaths.length < 1) return;
			document.getElementById('inPathWAVText').value = result.filePaths[0];
			loadNewWAVFile();
		}).catch(err => {
			clog("!ERROR! Error occured getting path.  More info logged to console.");
			console.log(err)
		})
	});
	
	document.getElementById('inRulePathBrowse').addEventListener("click", function(){
		dialog.showOpenDialog({
			properties: ['openFile'],
			filters:[
				{name: "Rule File", extensions:["rule","r"]},
				{name: "any", extensions:["*"]}]
		}).then(result => {
			if(result.canceled || result.filePaths.length < 1) return;
			document.getElementById('inPathRuleText').value = result.filePaths[0];
			loadRuleFile();
		}).catch(err => {
			clog("!ERROR! Error occured getting path.  More info logged to console.");
			console.log(err)
		})
	});
	
	document.getElementById('outRulePathBrowse').addEventListener("click", function(){
		dialog.showSaveDialog({
			title:"r.rule",
			properties: ['openFile'],
			buttonLabel: "Save",
			filters:[
				{name: "Rule File", extensions:["r","rule"]}]
		}).then(result => {
			if(result.canceled) return;
			document.getElementById('outPathRuleText').value = result.filePath;
			saveRuleFile();
		}).catch(err => {
			clog("!ERROR! Error occured getting path.  More info logged to console.");
			console.log(err)
		})
	});
	
	document.getElementById('outWAVPathBrowse').addEventListener("click", function(){
		dialog.showSaveDialog({
			title:"output.wav",
			properties: ['openFile'],
			buttonLabel: "Save",
			filters:[
				{name: ".WAV File", extensions:["wav"]}]
		}).then(result => {
			if(result.canceled) return;
			document.getElementById('outPathWAVText').value = result.filePath;
			exportWAV();
		}).catch(err => {
			clog("!ERROR! Error occured getting path.  More info logged to console.");
			console.log(err)
		})
	});
	
	document.getElementById('inWAVPathButton').addEventListener("click", loadNewWAVFile); //loadingfile
	
	document.getElementById('inRulePathButton').addEventListener("click", loadRuleFile); //loadingfile
	
	document.getElementById('outRulePathButton').addEventListener("click", saveRuleFile); //savingfile
	
	document.getElementById('outWAVPathButton').addEventListener("click", exportWAV); //exportingfile
	
	
	document.getElementById('consoleClear').addEventListener("click", function(){ logBox.innerHTML = ""; });
	
	document.getElementById('consoleHelp').addEventListener("click", function(){
		log("no help yet lol");
	});
	
	document.getElementById('consoleBinds').addEventListener("click", function(){
		log("CTRL-A......: Select All");
		log("CTRL-Q......: Unselect All");
		log("CTRL-D......: Duplicate Selection");
		log("CTRL-G......: Get settings of rule");
		log("CTRL-B......: Set settings of rule");
		log("CTRL-N......: Create new rule");
		log("CTRL-J......: Join selection");
		log("CTRL-K......: Split selection");
		log("CTRL-SPACE..: Skip and play selected audio");
		log("SHIFT-SPACE.: Play source audio in selection");
		log("CTRL-E......: Export final");
		log("CTRL-X......: Cut Selection");
		log("CTRL-C......: Copy Selection");
		log("CTRL-V......: Paste Selection");
		log("CTRL-Z......: Undo");
		log("CTRL-Y......: Redo");
		log("SPACE.......: Stop audio playing");
		log("TAB.........: Change channel view");
	});
	
	//quick patterns
	for(var i = 0; i < numQuickPatternBoxes; i++){
		document.getElementById('holderSet'+i).addEventListener("click", function(e){
			var num = pFloat(e.toElement.id.numerics());
			var samples = document.getElementById('sampleHolder'+num).value;
			var pattern = document.getElementById('patternHolder'+num).value;
			document.getElementById('samplesText').value = samples;
			document.getElementById('patternText').value = pattern;
			project.pushRules();
			setSamples(samples);
			setPattern(pattern);
		});
		document.getElementById('holderGet'+i).addEventListener("click", function(e){
			var num = pFloat(e.toElement.id.numerics());
			document.getElementById('sampleHolder'+num).value = getSamples();
			document.getElementById('patternHolder'+num).value = getPattern();
		});
	}
	
	//tabs
	for(var i = 0; i < tabs.length; i++){
		document.getElementById(tabs[i][0]).addEventListener("click", function(e){
			var buttonID = e.toElement.id;
			var tabNum = -1;
			for(var i = 0; i < tabs.length; i++){
				if(tabs[i][0] == buttonID){ //if its for the one that got clicked
					$("#"+tabs[i][1]).attr("hidden", false);
					$("#"+tabs[i][0]).attr("disabled", true);
				}else{
					$("#"+tabs[i][1]).attr("hidden", true);
					$("#"+tabs[i][0]).attr("disabled", false);
				}
			}
		});
	}
	
	//spp
	document.getElementById('sppDiv').addEventListener("click", function(){
		holdObj = document.getElementById('sppNum');
		holdVal = pFloat(document.getElementById('sppFac').value);
		holdVal = r(pFloat(holdObj.value)/holdVal);
		setSPP(holdVal);
	});
	document.getElementById('sppSub').addEventListener("click", function(){
		holdObj = document.getElementById('sppNum');
		holdVal = pFloat(document.getElementById('sppFac').value);
		holdVal = r(pFloat(holdObj.value)-holdVal);
		setSPP(holdVal);
	});
	document.getElementById('sppAdd').addEventListener("click", function(){
		holdObj = document.getElementById('sppNum');
		holdVal = pFloat(document.getElementById('sppFac').value);
		holdVal = r(pFloat(holdObj.value)+holdVal);
		setSPP(holdVal);
	});
	document.getElementById('sppMul').addEventListener("click", function(){
		holdObj = document.getElementById('sppNum');
		holdVal = pFloat(document.getElementById('sppFac').value);
		holdVal = r(pFloat(holdObj.value)*holdVal);
		setSPP(holdVal);
	});
	$('#sppNum').on("keyup", function(e) {
		if (e.keyCode == 13) {
			holdObj = document.getElementById('sppNum');
			holdVal = r(pFloat(holdObj.value));
			setSPP(holdVal);
			renderAll();
		}
	});
	
	//Offset
	document.getElementById('offsetDiv').addEventListener("click", function(){
		holdObj = document.getElementById('offsetNum');
		holdVal = pFloat(document.getElementById('offsetFac').value);
		holdVal = pFloat(holdObj.value)/holdVal;
		setOffset(holdVal);
	});
	document.getElementById('offsetSub').addEventListener("click", function(){
		holdObj = document.getElementById('offsetNum');
		holdVal = pFloat(document.getElementById('offsetFac').value);
		holdVal = pFloat(holdObj.value)-holdVal;
		setOffset(holdVal);
	});
	document.getElementById('offsetAdd').addEventListener("click", function(){
		holdObj = document.getElementById('offsetNum');
		holdVal = pFloat(document.getElementById('offsetFac').value);
		holdVal = pFloat(holdObj.value)+holdVal;
		setOffset(holdVal);
	});
	document.getElementById('offsetMul').addEventListener("click", function(){
		holdObj = document.getElementById('offsetNum');
		holdVal = pFloat(document.getElementById('offsetFac').value);
		holdVal = pFloat(holdObj.value)*holdVal;
		setOffset(holdVal);
	});
	$('#offsetNum').on("keyup", function(e) {
		if (e.keyCode == 13) {
			holdObj = document.getElementById('offsetNum');
			holdVal = pFloat(holdObj.value);
			setOffset(holdVal);
			renderAll();
		}
	});
	
	//Samples
	document.getElementById('samplesGet').addEventListener("click", function(){
		document.getElementById('samplesText').value = getSamples();
	});
	document.getElementById('samplesSet').addEventListener("click", function(){
		setSamples(document.getElementById('samplesText').value);
	});
	
	//Pattern
	document.getElementById('patternGet').addEventListener("click", function(){
		document.getElementById('patternText').value = getPattern();
	});
	document.getElementById('patternSet').addEventListener("click", function(){
		setPattern(document.getElementById('patternText').value);
	});
	
	
	//Length
	document.getElementById('lengthGet').addEventListener("click", function(){
		document.getElementById('lengthNum').value = getLength();
	});
	document.getElementById('lengthSet').addEventListener("click", function(){
		setLength(document.getElementById('lengthNum').value);
	});
	document.getElementById('lengthAvg').addEventListener("click", function(){
		document.getElementById('lengthNum').value = getLengthAvg();
	});
	document.getElementById('lengthDiv').addEventListener("click", function(){
		holdObj = document.getElementById('lengthNum');
		holdVal = pFloat(document.getElementById('lengthFac').value);
		holdVal = pFloat(holdObj.value)/holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('lengthSub').addEventListener("click", function(){
		holdObj = document.getElementById('lengthNum');
		holdVal = pFloat(document.getElementById('lengthFac').value);
		holdVal = pFloat(holdObj.value)-holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('lengthAdd').addEventListener("click", function(){
		holdObj = document.getElementById('lengthNum');
		holdVal = pFloat(document.getElementById('lengthFac').value);
		holdVal = pFloat(holdObj.value)+holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('lengthMul').addEventListener("click", function(){
		holdObj = document.getElementById('lengthNum');
		holdVal = pFloat(document.getElementById('lengthFac').value);
		holdVal = pFloat(holdObj.value)*holdVal;
		holdObj.value = truncate(holdVal);
	});
	
	//Factor
	document.getElementById('factorGet').addEventListener("click", function(){
		document.getElementById('factorNum').value = getFactor();
	});
	document.getElementById('factorSet').addEventListener("click", function(){
		setFactor(document.getElementById('factorNum').value);
	});
	document.getElementById('factorAvg').addEventListener("click", function(){
		document.getElementById('factorNum').value = getFactorAvg();
	});
	document.getElementById('factorDiv').addEventListener("click", function(){
		holdObj = document.getElementById('factorNum');
		holdVal = pFloat(document.getElementById('factorFac').value);
		holdVal = pFloat(holdObj.value)/holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('factorSub').addEventListener("click", function(){
		holdObj = document.getElementById('factorNum');
		holdVal = pFloat(document.getElementById('factorFac').value);
		holdVal = pFloat(holdObj.value)-holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('factorAdd').addEventListener("click", function(){
		holdObj = document.getElementById('factorNum');
		holdVal = pFloat(document.getElementById('factorFac').value);
		holdVal = pFloat(holdObj.value)+holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('factorMul').addEventListener("click", function(){
		holdObj = document.getElementById('factorNum');
		holdVal = pFloat(document.getElementById('factorFac').value);
		holdVal = pFloat(holdObj.value)*holdVal;
		holdObj.value = truncate(holdVal);
	});
	
	//Volume
	document.getElementById('volumeGet').addEventListener("click", function(){
		document.getElementById('volumeNum').value = getVolume();
	});
	document.getElementById('volumeSet').addEventListener("click", function(){
		setVolume(document.getElementById('volumeNum').value);
	});
	document.getElementById('volumeAvg').addEventListener("click", function(){
		document.getElementById('volumeNum').value = getVolumeAvg();
	});
	document.getElementById('volumeDiv').addEventListener("click", function(){
		holdObj = document.getElementById('volumeNum');
		holdVal = pFloat(document.getElementById('volumeFac').value);
		holdVal = pFloat(holdObj.value)/holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('volumeSub').addEventListener("click", function(){
		holdObj = document.getElementById('volumeNum');
		holdVal = pFloat(document.getElementById('volumeFac').value);
		holdVal = pFloat(holdObj.value)-holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('volumeAdd').addEventListener("click", function(){
		holdObj = document.getElementById('volumeNum');
		holdVal = pFloat(document.getElementById('volumeFac').value);
		holdVal = pFloat(holdObj.value)+holdVal;
		holdObj.value = truncate(holdVal);
	});
	document.getElementById('volumeMul').addEventListener("click", function(){
		holdObj = document.getElementById('volumeNum');
		holdVal = pFloat(document.getElementById('volumeFac').value);
		holdVal = pFloat(holdObj.value)*holdVal;
		holdObj.value = truncate(holdVal);
	});
	
	
	//All
	document.getElementById('allGet').addEventListener("click", getAllProps);
	document.getElementById('allSet').addEventListener("click", setAllProps);
	document.getElementById('allAvg').addEventListener("click", getAllPropsAvg);
	
	//Make
	document.getElementById('makeRule').addEventListener("click", newRule);
	
	//Label
	document.getElementById('labelGet').addEventListener("click", function(){
		document.getElementById('labelText').value = getLabel();
	});
	document.getElementById('labelSet').addEventListener("click", function(){
		setLabel(document.getElementById('labelText').value);
	});
	
	//Color
	document.getElementById('colorGet').addEventListener("click", function(){
		document.getElementById('colorText').value = getColor();
	});
	document.getElementById('colorSet').addEventListener("click", function(){
		setColor(document.getElementById('colorText').value);
	});
	
	//export settings
	document.getElementById('expFacSet').addEventListener("click", function(){
		exportSet.finalSpeedFactor = pFloat(document.getElementById('expFac').value);
		renderRules();
	});
	document.getElementById('expSewSet').addEventListener("click", function(){
		exportSet.smoothingRate = r(pFloat(document.getElementById('expSew').value));
	});
	document.getElementById('expBlurSet').addEventListener("click", function(){
		exportSet.blurLength = r(pFloat(document.getElementById('expBlur').value));
	});
	
	
	//play/stop buttons
	document.getElementById('playIn').addEventListener("click", playInWAV);
	
	document.getElementById('playOut').addEventListener("click", playOutWAV);
		
	document.getElementById('stopButton').addEventListener("click", stopWAV);
	

	
	//███████████████████████████████████████████//MOUSE INTERACTIONS//███████████████████████████████████████████//
	
	//keep track of mouse pos
	$(document).mousemove(function(event) {
        mouse.x = event.pageX-10;
        mouse.y = event.pageY-10;
		if(mouse.m1){
			if(mouse.ly >= ruleHeadspace && mouse.ly < waveCan.getHeight()-measureBottomspace-ruleBottomspace){ //drag space
				var holdSample = r(mouse.x*rendSet.spp+rendSet.start*inWAV.getSampleRate());
				setOffset((mouse.overSample-mouse.x*rendSet.spp)/inWAV.getSampleRate());
			}
			if(mouse.ly >= 0 && mouse.ly < ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace){ //select space
				if(!event.ctrlKey){
					selectRuleUnderCursor();
				}else{
					if(mouse.selecting){
						selectRuleUnderCursor();
					}else{
						deselectRuleUnderCursor();
					}
				}
			}
			if(mouse.ly >= ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace && mouse.ly < ruleHeadspace){ //scale space
				if(selection.isContinuous() && selection.numSelected() > 0){
					holdVal = selection.getLength();
					holdVal2 = mouse.overSampleRaw - selection.getStart();
					selection.scaleSelection(holdVal2/holdVal);
					if(event.shiftKey){ //slide back but move the difference to the next rule
						holdIndex = selection.getLastRuleIndex();
						if(++holdIndex !== rules.length){//if the last rule isn't selected
							rules[holdIndex].length += holdVal-holdVal2;
							if(rules[holdIndex].length < 1) rules[holdIndex].length = 0;
						}
					}
					renderRules();
				}
			}
		}else{
			mouse.lx = mouse.x;
			mouse.ly = mouse.y;
			mouse.overSample = r(mouse.x*rendSet.spp+rendSet.start*inWAV.getSampleRate());
			renderViewStats();
		}
		mouse.overSampleRaw = r(mouse.x*rendSet.spp+rendSet.start*inWAV.getSampleRate());
    });
	
	//keep track of mouse press
	document.body.onmousedown = function(event) {
		mouse.m1 = true;
		if(mouse.ly >= ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace && mouse.ly < ruleHeadspace){ //scale space
			pushRuleState();
		}
		if(mouse.ly >= 0 && mouse.ly < ruleHeadspace-ruleSampleLabelSpace-ruleDraggerSpace){
			if(event.ctrlKey){
				mouse.selecting = toggleRuleUnderCursor();
			}else{
				if(!event.shiftKey){
					selection.clear();
					renderRules();
				}else{
					extendSelection(project.getRuleIndexByStartPos(mouse.overSampleRaw)); //get rule mouse is over and extend to it
					renderRules();
				}
				selectRuleUnderCursor();
			}
		}
	}
	document.body.onmouseup = function(event) {
		mouse.m1 = false;
		mouse.selecting = false;
	}
	
	//canvas scrolling
	$('#ruleCanvas').bind('mousewheel', function(e){
		if(e.shiftKey){
			if(e.originalEvent.wheelDelta /120 > 0) {
				setOffset(rendSet.start + (waveCan.getWidth()*rendSet.spp/inWAV.getSampleRate())/16 );
			}
			else{
				setOffset(rendSet.start - (waveCan.getWidth()*rendSet.spp/inWAV.getSampleRate())/16 );
			}
		}else{
			var difference = 0; //measured in samples
			var mx1, mx2;
			mx1 = mouse.overSample; //this should point to whichever sample the mouse is over
			if(e.originalEvent.wheelDelta /120 > 0) {
				setSPP(rendSet.spp*(1/1.5),true);
			}else{
				setSPP(rendSet.spp*1.5,true);
			}
			mx2 = r(mouse.x*rendSet.spp+rendSet.start*inWAV.getSampleRate()); //this should point to whichever sample the mouse is over (again)
			difference = mx1 - mx2;
			setOffset(rendSet.start + difference/inWAV.getSampleRate());
		}
		renderViewStats();
    });
	
	//███████████████████████████████████████████//ADVANCED KEYBINDS//███████████████████████████████████████████//
	Mousetrap.bind(['command+a', 'ctrl+a'], function() {
		selection.selectAll();
		renderRules();
		return false;
	});
	Mousetrap.bind(['command+q', 'ctrl+q'], function() {
		selection.clear();
		renderRules();
		return false;
	});
	Mousetrap.bind(['command+d', 'ctrl+d'], duplicateSelected);
	Mousetrap.bind(['del', 'delete', 'backspace'], deleteSelected);
	Mousetrap.bind(['command+c', 'ctrl+c'], copyRules);
	Mousetrap.bind(['command+x', 'ctrl+x'], cutRules);
	Mousetrap.bind(['command+v', 'ctrl+v'], pasteRules);
	Mousetrap.bind(['command+n', 'ctrl+n'], newRule);
	Mousetrap.bind(['command+g', 'ctrl+g'], getAllProps);
	Mousetrap.bind(['command+b', 'ctrl+b'], setAllProps);
	Mousetrap.bind(['command+e', 'ctrl+e'], exportWAV);
	Mousetrap.bind(['command+z', 'ctrl+z'], undo);
	Mousetrap.bind(['command+y', 'ctrl+y'], redo);
	Mousetrap.bind(['command+j', 'ctrl+j'], joinSelected);
	Mousetrap.bind(['command+k', 'ctrl+k'], splitSelected);
	Mousetrap.bind(['command+shift+z', 'ctrl+shift+z'], redo);
	Mousetrap.bind(['shift+space', 'shift+space'], playInWAV);
	Mousetrap.bind(['command+space', 'ctrl+space'], playOutWAV);
	Mousetrap.bind(['space'], stopWAV);
	Mousetrap.bind(['tab'], changeChannelView);
	
	
})


