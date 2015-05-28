'use strict';

var path = require('path'),
	async = require('async'),
	fs = require('fs-extra'),
	multer = require('multer'),
	moment = require('moment'),
	pkgcloud = require('pkgcloud'),
	// extend = require('util-extend'),
	cloudprovider,
	cloudproviderfilepath,
	cloudstorageclient,
	cloudStorageClientError,
	cloudStorageContainer,
	cloudStoragePublicPath,
	CoreExtension,
	CoreUtilities,
	CoreController,
	// multiupload_rename,
	// multiupload_changeDest,
	// multiupload_onParseStart,
	upload_dir,
	temp_upload_dir,
	appSettings,
	mongoose,
	MediaAsset,
	logger;

var multiupload_rename = function(fieldname,filename,req,res){
	if(req.user){
		return req.user._id+'-'+fieldname+'-'+filename+moment().format('YYYY-MM-DD_HH-m-ss');
	}
	else{
		return fieldname+'-'+filename+moment().format('YYYY-MM-DD_HH-m-ss');
	}
};

var multiupload_changeDest = function(dest, req, res) {
	var current_date = moment().format('YYYY/MM/DD'),
		upload_path_dir = path.join(process.cwd(), upload_dir,'cloudfiles',current_date);
  		// return upload_path_dir; 

	// logger.debug('upload_path_dir',upload_path_dir);
	fs.ensureDirSync(upload_path_dir);
	return upload_path_dir; 
};

var multiupload_onParseStart = function () {
  logger.debug('Form parsing started at: ', new Date());
};

var multiupload = multer({
	includeEmptyFields: false,
	putSingleFilesInArray: true,
	dest:temp_upload_dir,
	rename: multiupload_rename,
	changeDest: multiupload_changeDest,
	onParseStart: multiupload_onParseStart,
	onParseEnd: function(req,next){
		logger.debug('req.body',req.body);
		logger.debug('req.files',req.files);
		var files = [],
			current_date = moment().format('YYYY/MM/DD'),
			clouddir = path.join('cloudfiles',current_date),
			cloudfiles = [],
			file_obj,
			get_file_obj= function(data){
				var returndata = data;
				returndata.uploaddirectory = returndata.path.replace(process.cwd(),'').replace(returndata.name,'');
				return returndata;
			},
			deletelocalfile = function(filepath){ 
				fs.remove(filepath, function (err) {
					if (err) {
						logger.error(err);
					}
					else {
						logger.silly('removing temp file', filepath);
					}
				});
			};
		for(var x in req.files){
			if(Array.isArray(req.files[x])){
				for (var y in req.files[x]){
					file_obj = get_file_obj( req.files[x][y]);
					// file_obj.uploaddirectory = file_obj.path.replace(process.cwd(),'');
					// file_obj.uploaddirectory = file_obj.uploaddirectory.replace(file_obj.name,'');
					files.push(file_obj);
				}
			}
			else{
				file_obj = get_file_obj(req.files[x]);
				// file_obj.uploaddirectory = file_obj.path.replace(process.cwd(),'');
				// file_obj.uploaddirectory = file_obj.uploaddirectory.replace(file_obj.name,'');
				files.push(file_obj);
			}
		}
		// req.controllerData = (req.controllerData) ? req.controllerData : {};
		// req.controllerData.files = files;
		// next();

		try{
			if(files){
				async.eachSeries(files,
					function(uploadedfile,eachcb){
						var localuploadfile = fs.createReadStream(uploadedfile.path),
							newfilepath = path.join(clouddir,uploadedfile.name),
							cloudupload =	cloudstorageclient.upload({
								container: cloudStorageContainer,
								remote: newfilepath,
								local: uploadedfile.path,
								'Cache-Control': 'max-age=86400',
								cacheControl: 'max-age=86400',
						    ACL: 'public-read',
						    acl: 'public-read',
								headers: { 
								// optionally provide raw headers to send to cloud files
									'cache-control': 'max-age=86400',
									'Cache-Control': 'max-age=86400',
									'x-amz-meta-Cache-Control' : 'max-age=86400' 

								}
							});
						cloudupload.on('success',function(uploaded_cloud_file){
							uploaded_cloud_file.attributes = cloudStoragePublicPath;
							uploaded_cloud_file.size = uploadedfile.size;
							uploaded_cloud_file.filename = uploadedfile.name;
							uploaded_cloud_file.name = uploadedfile.name;
							uploaded_cloud_file.assettype = uploadedfile.mimetype;
							uploaded_cloud_file.path = newfilepath;
							uploaded_cloud_file.locationtype = cloudprovider.provider;
							// uploaded_cloud_file.attributes.periodicDirectory = uploadDirectory;
							// uploaded_cloud_file.attributes.periodicPath = path.join(cloudStoragePublicPath.cdnUri,newfilepath);
							uploaded_cloud_file.fileurl = cloudStoragePublicPath.cdnUri + '/' + newfilepath;
							uploaded_cloud_file.attributes.periodicFilename = uploadedfile.name;
							uploaded_cloud_file.attributes.cloudfilepath = newfilepath;
							uploaded_cloud_file.attributes.cloudcontainername = cloudStorageContainer.name || cloudStorageContainer;

							logger.silly('uploaded_cloud_file',uploaded_cloud_file);
							cloudfiles.push(uploaded_cloud_file);
							eachcb();
							deletelocalfile(uploadedfile.path);
						});
						// cloudupload.on('end',function(){
						// 	deletelocalfile(uploadedfile.path);
						// });
						cloudupload.on('error',function(err){
							logger.error('asyncadmin - async each cloudupload error',err);
							eachcb(err);
							deletelocalfile(uploadedfile.path);
						});
						localuploadfile.pipe(cloudupload);

				},function(err){
					if(err){
						next(err);
					}
					else{
						req.controllerData = (req.controllerData) ? req.controllerData : {};
						req.controllerData.files = cloudfiles;
						next();
					}
				});
			}
			else{
				next();
			}
		}
		catch(e){
			logger.error('asyncadmin - cloudupload.multiupload',e);
			next(e);
		}
	}
});	

/**
 * upload a document from a form upload, store it in your cloud provider storage, remove from server after moved to cloud service
 * @param  {object} req 
 * @param  {object} res 
 * @return {Function} next() callback
 */
// var upload = function (req, res, next) {
// 	if (cloudStorageClientError) {
// 		CoreController.handleDocumentQueryErrorResponse({
// 			err: cloudStorageClientError,
// 			res: res,
// 			req: req
// 		});
// 	}
// 	else {
// 		var form = new formidable.IncomingForm(),
// 			files = [],
// 			returnFile,
// 			returnFileObj = {},
// 			formfields,
// 			formfiles,
// 			d = new Date(),
// 			clouddir = 'clouduploads/files/' + d.getUTCFullYear() + '/' + d.getUTCMonth() + '/' + d.getUTCDate(),
// 			uploadDirectory = '/public/' + clouddir,
// 			fullUploadDir = path.join(process.cwd(), uploadDirectory);
// 		req.controllerData = (req.controllerData) ? req.controllerData : {};

// 		fs.ensureDir(fullUploadDir, function (err) {
// 			if (err) {
// 				CoreController.handleDocumentQueryErrorResponse({
// 					err: err,
// 					res: res,
// 					req: req
// 				});
// 			}
// 			else {
// 				form.keepExtensions = true;
// 				form.uploadDir = fullUploadDir;
// 				form.parse(req, function (err, fields, files) {
// 					formfields = fields;
// 					formfiles = files;
// 					// console.log(err, fields, files);
// 				});
// 				form.on('error', function (err) {
// 					logger.error(err);
// 					CoreController.handleDocumentQueryErrorResponse({
// 						err: err,
// 						res: res,
// 						req: req
// 					});
// 				});
// 				form.on('file', function (field, file) {
// 					returnFile = file;
// 					files.push(file);
// 				});
// 				form.on('end', function () {
// 					var namespacewithusername = (req.user && req.user._id)? req.user._id.toString() + '-' : '',
// 						newfilename = namespacewithusername + CoreUtilities.makeNiceName(path.basename(returnFile.name, path.extname(returnFile.name))) + path.extname(returnFile.name),
// 						newfilepath = path.join(clouddir, newfilename);

// 					var localuploadfile = fs.createReadStream(returnFile.path);

// 					var deletelocalfile = function(){ 
// 						fs.remove(returnFile.path, function (err) {
// 							if (err) {
// 								logger.error(err);
// 							}
// 							else {
// 								logger.silly('removing temp file', returnFile.path);
// 							}
// 						});
// 					};
// 					try{
// 						var cloudupload =	cloudstorageclient.upload({
// 							container: cloudStorageContainer,
// 							remote: newfilepath,
// 							local: returnFile.path,
// 					    ACL: 'public-read',
// 							headers: { 
// 							// optionally provide raw headers to send to cloud files
// 								'Cache-Control': 'max-age=86400'
// 							}
// 						});

// 						// cloudupload.on('data',function(data){
// 						// 	console.log('cloudupload data',data);
// 						// });

// 						cloudupload.on('error',function(err){
// 							console.log('cloudupload error',err);
// 							logger.error(err);
// 							CoreController.handleDocumentQueryErrorResponse({
// 								err: err,
// 								res: res,
// 								req: req
// 							});
// 							deletelocalfile();
// 						});

// 						cloudupload.on('success',function(file){
// 							returnFileObj.attributes = cloudStoragePublicPath;
// 							returnFileObj.size = returnFile.size;
// 							returnFileObj.filename = returnFile.name;
// 							returnFileObj.assettype = returnFile.type;
// 							returnFileObj.path = newfilepath;
// 							returnFileObj.locationtype = cloudprovider.provider;
// 							// returnFileObj.attributes.periodicDirectory = uploadDirectory;
// 							// returnFileObj.attributes.periodicPath = path.join(cloudStoragePublicPath.cdnUri,newfilepath);
// 							returnFileObj.fileurl = cloudStoragePublicPath.cdnUri + '/' + newfilepath;
// 							returnFileObj.attributes.periodicFilename = newfilename;
// 							returnFileObj.attributes.cloudfilepath = newfilepath;
// 							returnFileObj.attributes.cloudcontainername = cloudStorageContainer.name || cloudStorageContainer;

// 							// console.log('cloudupload file',file)
// 							// console.log('returnFileObj', returnFileObj);

// 							// req.controllerData.fileData = returnFileObj;
// 							req.controllerData.fileData = extend(returnFileObj,formfields);

// 							next();
// 							deletelocalfile();
// 						});

// 						cloudupload.on('end',function(){
// 							console.log('cloudupload ended');
// 						});

// 						localuploadfile.pipe(cloudupload);
// 					}
// 					catch(e){
// 						logger.error(e);
// 						CoreController.handleDocumentQueryErrorResponse({
// 							err: e,
// 							res: res,
// 							req: req
// 						});
// 						deletelocalfile();
// 					}

// 				});
// 			}
// 		});
		
// 	}
// };

/**
 * deletes file from cloud and removes document from mongo database
 * @param  {object} req 
 * @param  {object} res 
 */
var remove = function (req, res) {
	var asset = req.controllerData.asset;
	async.parallel({
			deletefile: function (callback) {
				// console.log('asset', asset);
				if (asset.locationtype === 'rackspace' || asset.locationtype === 'amazon') {
					cloudstorageclient.removeFile(asset.attributes.cloudcontainername, asset.attributes.cloudfilepath, callback);
				}
				else{
					fs.remove(path.join(process.cwd(), asset.attributes.periodicPath), callback);
				}
			},
			removeasset: function (callback) {
				CoreController.deleteModel({
					model: MediaAsset,
					deleteid: asset._id,
					req: req,
					res: res,
					callback: callback
				});
			}
		}, function (err
			//, results
		) {
		if (err) {
			CoreController.handleDocumentQueryErrorResponse({
				err: err,
				res: res,
				req: req
			});
		}
		else {
			CoreController.handleDocumentQueryRender({
				req: req,
				res: res,
				redirecturl: '/p-admin/assets',
				responseData: {
					result: 'success',
					data: asset
				}
			});
		}
	});
};

/**
 * create storage container from configuration in provider.json
 * @param  {object} req 
 * @param  {object} res 
 * @return {Function} next() callback
 */
var createStorageContainer = function () {
	fs.readJson(cloudproviderfilepath, function (err, data) {
		if (err) {
			cloudStorageClientError = err;
			logger.error('createStorageContainer readJson cloudproviderfilepath',cloudproviderfilepath);
			logger.error(err);
		}
		else {
			try {
				cloudprovider = data[appSettings.application.environment];
				cloudstorageclient = pkgcloud.storage.createClient(cloudprovider);
				var storageContainerOptions = {
						name: (cloudprovider.containername) ? cloudprovider.containername : 'periodicjs',
						type: 'public',
						metadata: {
							env: appSettings.application.environment,
							name: appSettings.name
						}
					};
				if(cloudprovider.provider ==='amazon'){

					cloudStorageContainer = cloudprovider.containername || cloudprovider.Bucket ||  cloudprovider.bucket;
					cloudStoragePublicPath = {
						cdnUri: 'http://'+cloudstorageclient.s3.config.endpoint+'/'+cloudStorageContainer,
						cdnSslUri: cloudstorageclient.s3.endpoint.href+cloudStorageContainer,
						endpoint:cloudstorageclient.s3.endpoint
					};
				}
				else if(cloudprovider.provider ==='rackspace'){
					cloudstorageclient.createContainer(
						storageContainerOptions,
						function (err, container) {
							if (err) {
								console.log('failed on storage client',err);
								console.log(err.stack);
								cloudStorageClientError = err;
								throw Error(err);
							}
							else {
								console.log('created container');
								cloudStorageContainer = container;
								if (cloudprovider.provider === 'rackspace') {
									cloudstorageclient.setCdnEnabled(cloudStorageContainer, true, function (error, cont) {
										if (error) {
											cloudStorageClientError = error;
											throw Error(error);
										}
										else if (cont) {
											cloudStoragePublicPath = {
												cdnUri: cont.cdnUri,
												cdnSslUri: cont.cdnSslUri,
												cdnStreamingUri: cont.cdnStreamingUri,
												cdniOSUri: cont.cdniOSUri
											};
											// console.log('cont', cont);
											// console.log('cloudStoragePublicPath', cloudStoragePublicPath);
											logger.silly('Successfully Created CDN Bucket');
										}
									});
								}
							}
						});
				}
				// console.log('cloudstorageclient',cloudstorageclient);
				// console.log('cloudprovider',cloudprovider);
				// console.log('storageContainerOptions',storageContainerOptions);
				cloudprovider.containername = cloudprovider.containername || cloudprovider.Bucket ||  cloudprovider.bucket || 'periodicjs';
			}
			catch (e) {
				logger.error('cloudstorageclient.createContainer cloudStorageClientError');
				cloudStorageClientError = e;
				console.log(e);
				logger.error(e);
			}
		}
	});
};

/**
 * cloudupload controller
 * @module clouduploadController
 * @{@link https://github.com/typesettin/periodicjs.ext.clouduploads}
 * @author Yaw Joseph Etse
 * @copyright Copyright (c) 2014 Typesettin. All rights reserved.
 * @license MIT
 * @requires module:async
 * @requires module:path
 * @requires module:fs-extra
 * @requires module:formidable
 * @requires module:pkgcloud
 * @requires module:periodicjs.core.utilities
 * @requires module:periodicjs.core.controller
 * @requires module:periodicjs.core.extensions
 * @param  {object} resources variable injection from current periodic instance with references to the active logger and mongo session
 */
var controller = function (resources) {
	logger = resources.logger;
	mongoose = resources.mongoose;
	appSettings = resources.settings;
	CoreController = resources.core.controller;
	CoreUtilities = resources.core.utilities;
	CoreExtension = resources.core.extension;
	MediaAsset = mongoose.model('Asset');
	// multiupload_rename = resources.app.controller.native.asset.multiupload_rename;	
	// multiupload_changeDest = resources.app.controller.native.asset.multiupload_changeDest;
	// multiupload_onParseStart = resources.app.controller.native.asset.multiupload_onParseStart;
	upload_dir = resources.app.controller.native.asset.upload_dir;
	temp_upload_dir = path.join(process.cwd(),upload_dir, '/tmp');

	// console.log('temp_upload_dir',temp_upload_dir);
	// console.log('resources.app.controller.native.asset',resources.app.controller.native.asset);

	cloudproviderfilepath = path.join(CoreExtension.getconfigdir({
		extname: 'periodicjs.ext.clouduploads'
	}), 'provider.json');
	// Collection = mongoose.model('Collection');
	// 
	// cdn files: https://github.com/pkgcloud/pkgcloud/issues/324
	// rackspace: https://gist.github.com/rdodev/129592b4addcebdf6ccd
	createStorageContainer();

	return {
		multiupload: multiupload,
		remove: remove
	};
};

module.exports = controller;
