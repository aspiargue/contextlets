'use strict';

(function (execute)
{
	var prefDefaults =
	{
		items: [],
		lineNumbers: false,
		validate: true,
	};
	
	var renderers = [];
	var rendererLookup = {};
	
	/**
	 * Create the API for the user's script.
	 */
	var createAPI = function (message)
	{
		// Deep-clone the message to ensure that the original
		// version is preserved. The messaging API requires
		// JSON-serializability anyway.
		
		var messageClone = JSON.parse(JSON.stringify(message));
		
		var api =
		{
			/**
			 * Asynchronously run user-provided code in the given scope.
			 */
			runAs: function (scope, code, params)
			{
				switch (scope)
				{
				case 'background':
					// Execute the provided code locally.
					
					window.setTimeout(function ()
					{
						execute.call(createRemoteMessage(message, code, params));
					}, 0);
					break;
				
				case 'content':
					// Execute the provided code in the content script.
					
					browser.tabs.sendMessage(message.tab.id, createRemoteMessage(message, code, params));
					break;
				
				default:
					throw new Error('Unrecognized scope.');
				}
			},
			message: messageClone,
		};
		
		Object.assign(api, messageClone);
		return api;
	};
	
	/**
	 * Create message to be executed in a different scope.
	 */
	var createRemoteMessage = function (message, code, params)
	{
		var remoteMessage = {};
		Object.assign(remoteMessage, message);
		
		if (typeof code == 'function')
		{
			// The user provided a function instead of a code string.
			// Convert this into a code string so that the function
			// will be called when it's evaled (without any of the
			// lexical scope). "this" should be inherited from where
			// the eval is run.
			
			code = '('+code.toSource()+').call(this);';
		}
		else
		{
			code += '';
		}
		
		remoteMessage.code = code;
		remoteMessage.params = params === undefined ? null : params;
		return remoteMessage;
	};
	
	/**
	 * Set up the context menu items from the user settings.
	 */
	var update = function ()
	{
		browser.storage.local.get(prefDefaults).then(function (prefs)
		{
			// Remove all of our context menu items first.
			
			browser.contextMenus.removeAll(function ()
			{
				renderers.forEach(function (renderer)
				{
					renderer.items = [];
				});
				
				prefs.items.forEach(function (item)
				{
					if (item.contexts.length == 0)
					{
						return;
					}
					
					// These settings will be used for all types of contexts.
					
					var commonSettings =
					{
						checked: item.checked,
						enabled: item.enabled,
						title: item.title,
						type: item.type,
					};
					
					if (typeof item.icons == 'string')
					{
						commonSettings.icons = {16: item.icons};
					}
					else if (item.icons != null)
					{
						commonSettings.icons = item.icons;
					}
					
					// Get the list of URL patterns to match on.
					
					var patterns = item.patterns.replace(/^[\r\n]+|[\r\n]+$/g, '');
					
					if (item.patterns == '')
					{
						patterns = ['<all_urls>'];
					}
					else
					{
						patterns = patterns.split(/[\r\n]+/g);
					}
					
					// Depending on the type of context, we'll either want to match
					// the URL against the target ("object"-type contexts) or the
					// document ("page"-type contexts). Let's organize the contexts
					// into these two groups and define the menu items separately.
					
					var pageContexts = [];
					var objectContexts = [];
					
					item.contexts.forEach(function (context)
					{
						switch (context)
						{
							case 'editable':
							case 'frame':
							case 'page':
							case 'password':
							case 'selection':
							case 'tab':
								pageContexts.push(context);
								break;
							
							default:
								objectContexts.push(context);
						}
					});
					
					if (item.extensionId == null)
					{
						item.extensionId = browser.runtime.id;
					}
					
					if (!Object.prototype.hasOwnProperty.call(rendererLookup, item.extensionId))
					{
						rendererLookup[item.extensionId] = renderers.length;
						renderers.push(
						{
							extensionId: item.extensionId,
							items: [],
						});
					}
					
					var index = rendererLookup[item.extensionId];
					
					if (pageContexts.length > 0)
					{
						renderers[index].items.push(Object.assign(
						{
							contexts: pageContexts,
							documentUrlPatterns: item.documentUrlPatterns === undefined ? patterns : item.documentUrlPatterns,
							id: item.id+'-page',
							targetUrlPatterns: item.targetUrlPatterns,
						}, commonSettings));
					}
					
					if (objectContexts.length > 0)
					{
						renderers[index].items.push(Object.assign(
						{
							contexts: objectContexts,
							documentUrlPatterns: item.documentUrlPatterns,
							id: item.id+'-object',
							targetUrlPatterns: item.targetUrlPatterns === undefined ? patterns : item.targetUrlPatterns,
						}, commonSettings));
					}
				});
				
				var runNextRenderer = function (index)
				{
					if (index >= renderers.length)
					{
						return;
					}
					
					var renderer = renderers[index];
					
					if (renderer.extensionId === browser.runtime.id)
					{
						// Local menu items.
						
						renderer.items.forEach(function (item)
						{
							browser.contextMenus.create(item);
						});
						
						runNextRenderer(index + 1);
					}
					else
					{
						// Menu items that will be rendered by another extension.
						
						browser.runtime.sendMessage(renderer.extensionId,
						{
							type: 'contextlets:items',
							items: renderer.items,
						}).then(function ()
						{
							runNextRenderer(index + 1);
						});
					}
				};
				
				runNextRenderer(0);
			});
		});
	};
	
	/**
	 * Run the script associated with a context menu item.
	 */
	var menuItemClicked = function (info, tab)
	{
		browser.storage.local.get(prefDefaults).then(function (prefs)
		{
			var itemId = (info.menuItemId+'').replace(/-(?:page|object)$/, '');
			var item = prefs.items.find(function (item)
			{
				return item.id == itemId;
			});
			
			if (item === undefined)
			{
				// Invalid item ID passed.
				
				return;
			}
			
			var message =
			{
				code: item.code,
				info: info,
				itemSettings: item,
				params: null,
				tab: tab,
			};
			
			// Execute the menu item's code in the configured scope.
			
			switch (item.scope)
			{
			case 'background':
				execute.call(createAPI(message));
				break;
			
			case 'content':
				browser.tabs.sendMessage(tab.id, message);
				break;
			
			default:
				throw new Error('Unrecognized scope.');
			}
		});
	};
	
	// Events to trigger reloading of the content menu items.
	
	browser.runtime.onInstalled.addListener(update);
	browser.runtime.onStartup.addListener(update);
	browser.storage.onChanged.addListener(function (prefs)
	{
		if (prefs.items)
		{
			update();
		}
	});
	
	// Listen for menu item clicks.
	
	browser.contextMenus.onClicked.addListener(menuItemClicked);
	
	// Listen for messages coming from the content script.
	
	browser.runtime.onMessage.addListener(function (message)
	{
		if (Object.prototype.hasOwnProperty.call(message, 'code'))
		{
			// We've received a call from the content script.
			
			execute.call(createAPI(message));
		}
	});
	
	// Listen for messages coming from other extensions.
	
	browser.runtime.onMessageExternal.addListener(function (message, sender)
	{
		if (!Object.prototype.hasOwnProperty.call(rendererLookup, sender.id))
		{
			// No items are associated with this extension. Ignore the message.
			
			return;
		}
		
		switch (message.type)
		{
		case 'contextlets:clicked':
			if (Object.prototype.hasOwnProperty.call(message, 'info') && Object.prototype.hasOwnProperty.call(message, 'tab'))
			{
				// We've received a click from a helper extension.
				
				menuItemClicked(message.info, message.tab);
			}
			
			break;
		
		case 'contextlets:update':
			update();
			break;
		}
	});
})(function ()
{
	// This is where the user's code is executed for background scripts.
	// The function is defined here so it doesn't inherit any of our
	// internal variables. This function should always be called in
	// the context of a createAPI() result.
	
	eval(this.code);
});
