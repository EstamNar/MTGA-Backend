const { getCurrentTimestamp, logger, generateMongoID, FastifyResponse } = require("../../utilities");
const { HideoutArea } = require('../models/HideoutArea');
const { HideoutProduction } = require('../models/HideoutProduction');
const { HideoutScavcase } = require('../models/HideoutScavcase');
const { Preset } = require('../models/Preset');
const { Item } = require('../models/Item');
const { database } = require('../../app');


class HideoutController {
    static async clientHideoutSettings(_request = null, reply = null) {
        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody(database.core.hideoutSettings)
        );
    }

    static async clientHideoutAreas(_request = null, reply = null) {
        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody(await HideoutArea.getAllWithoutKeys())
        );
    }

    static async clientHideoutProductionRecipes(_request = null, reply = null) {
        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody(await HideoutProduction.getAllWithoutKeys())
        );
    }

    static async clientHideoutProductionScavcaseRecipes(_request = null, reply = null) {
        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody(await HideoutScavcase.getAllWithoutKeys())
        );
    }

    static async startUpgradeArea(moveAction = null, _reply = null, playerProfile = null) {
        logger.logDebug(moveAction);
        if (playerProfile) {
            const templateHideoutArea = await HideoutArea.getBy("type", moveAction.areaType);
            const characterHideoutArea = await playerProfile.character.getHideoutAreaByType(moveAction.areaType);

            if (!templateHideoutArea) {
                logger.logError(`[startUpgradeArea] Upgrading HideoutArea failed. Unknown hideout area ${moveAction.areaType} in hideoutArea database.`);
                return;
            }

            if (!characterHideoutArea) {
                logger.logError(`[startUpgradeArea] Upgrading HideoutArea failed. Unknown hideout area ${moveAction.areaType} in character profile.`);
                return;
            }

            const nextLevel = characterHideoutArea.level + 1;
            if (typeof templateHideoutArea.stages[nextLevel] === "undefined") {
                logger.logError(`[startUpgradeArea] Upgrading HideoutArea ${templateHideoutArea._id} for character ${playerProfile.character._id} failed. The level ${nextLevel} doesn't exist.`);
                return;
            }

            const output = {
                items: {
                    new: [],
                    change: [],
                    del: []
                }
            };

            let allItemsTaken = true;
            for (const itemToTake of moveAction.items) {
                const itemTaken = await playerProfile.character.removeItem(itemToTake.id, itemToTake.count);
                if (itemTaken) {
                    if (typeof itemTaken.changed !== "undefined") {
                        output.items.change = output.items.change.concat(itemTaken.changed);
                    }

                    if (typeof itemTaken.removed !== "undefined") {
                        output.items.del = output.items.del.concat(itemTaken.removed);
                    }
                } else {
                    allItemsTaken = false;
                }
            }

            if (allItemsTaken) {
                const templateHideoutAreaStage = templateHideoutArea.stages[nextLevel];
                if (templateHideoutAreaStage.constructionTime > 0) {
                    const currentTime = await getCurrentTimestamp();
                    characterHideoutArea.completeTime = ~~(currentTime + templateHideoutAreaStage.constructionTime);
                    characterHideoutArea.constructing = true;
                }

                return output;
            } else {
                // How do return custom error to client!!1!1!!!111!elf?
                logger.logError(`[startUpgradeArea] Upgrading HideoutArea ${templateHideoutArea._id} for character ${playerProfile.character._id} failed. Unable to take required items.`);
                return;
            }
        }
    }

    static async completeUpgradeArea(moveAction = null, _reply = null, playerProfile = null) {
        if (playerProfile) {
            const templateHideoutArea = await HideoutArea.getBy("type", moveAction.areaType);
            const characterHideoutArea = await playerProfile.character.getHideoutAreaByType(moveAction.areaType);

            if (!templateHideoutArea) {
                logger.logError(`[completeUpgradeArea] Upgrading HideoutArea failed. Unknown hideout area ${moveAction.areaType} in hideoutArea database.`);
                return;
            }

            if (!characterHideoutArea) {
                logger.logError(`[completeUpgradeArea] Upgrading HideoutArea failed. Unknown hideout area ${moveAction.areaType} in character profile.`);
                return;
            }
            const nextLevel = characterHideoutArea.level + 1;
            const templateHideoutAreaStage = templateHideoutArea.stages[nextLevel];
            if (typeof templateHideoutAreaStage === "undefined") {
                logger.logError(`[completeUpgradeArea] Upgrading HideoutArea ${templateHideoutArea._id} for character ${playerProfile.character._id} failed. The level ${nextLevel} doesn't exist.`);
                return;
            }

            characterHideoutArea.level = nextLevel;
            characterHideoutArea.completeTime = 0;
            characterHideoutArea.constructing = false;

            const hideoutBonuses = templateHideoutAreaStage.bonuses;

            if (typeof hideoutBonuses !== "undefined" && hideoutBonuses.length > 0) {
                for (const hideoutBonus of hideoutBonuses) {
                    if (await playerProfile.character.applyHideoutBonus(hideoutBonus)) {

                    }
                }
            }
        }
    }

    static async addItemToAreaSlot(moveAction = null, _reply = null, playerProfile = null) {
        const output = { items: { new: [], change: [], del: [] } };
        if (playerProfile) {
            const hideoutArea = await playerProfile.character.getHideoutAreaByType(moveAction.areaType);
            for (const itemPosition in moveAction.items) {
                logger.logDebug(moveAction.items);
                logger.logDebug(itemPosition);

                if (moveAction.items.hasOwnProperty(itemPosition)) {
                    const itemData = moveAction.items[itemPosition];
                    const item = await playerProfile.character.getInventoryItemByID(itemData.id);
                    const slotData = {
                        item: [
                            {
                                _id: item._id,
                                _tpl: item._tpl,
                                upd: item.upd
                            }
                        ]
                    };
                    hideoutArea.slots[itemPosition] = slotData;
                    await playerProfile.character.removeItem(item._id);
                    output.items.del.push(item);
                }
            }
        }
        return output;
    }

    static async takeItemFromAreaSlot(moveAction = null, _reply = null, playerProfile = null) {
        const output = { items: { new: [], change: [], del: [] } };
        if (playerProfile) {
            const hideoutArea = await playerProfile.character.getHideoutAreaByType(moveAction.areaType);
            if (!hideoutArea) {
                logger.logError(`[takeItemFromAreaSlot] Unable to find hideout area type ${moveAction.areaType} for playerProfile ${playerProfile.character._id}.`);
                return output;
            }

            for (const slot in moveAction.slots) {
                for (const item of hideoutArea.slots[slot].item) {
                    const itemAdded = await playerProfile.character.addItem(await playerProfile.character.getStashContainer(), item._tpl, false, 1);
                    if (itemAdded) {
                        output.items.new = [...output.items.new, ...itemAdded];
                        hideoutArea.slots.splice(slot, 1);
                    }
                }
            }
        }
        return output;
    }

    static async toggleArea(moveAction = null, _reply = null, playerProfile = null) {
        if (playerProfile) {
            const hideoutArea = await playerProfile.character.getHideoutAreaByType(moveAction.areaType);
            if (!hideoutArea) {
                logger.logError(`[toggleArea] Unable to find hideout area type ${moveAction.areaType} for playerProfile ${playerProfile.character._id}.`);
                return;
            }
            hideoutArea.active = moveAction.enabled;
        }
    }

    static async singleProductionStart(moveAction = null, _reply = null, playerProfile = null) {
        logger.logDebug(moveAction);
        if (playerProfile) {
            const hideoutProductionTemplate = await HideoutProduction.get(moveAction.recipeId);
            if (!hideoutProductionTemplate) {
                logger.logError(`[singleProductionStart] Starting hideout production failed. Unknown hideout production with Id ${moveAction.recipeId} in hideoutProduction database.`);
                return;
            }

            const output = {
                items: {
                    new: [],
                    change: [],
                    del: []
                }
            };

            let allItemsTaken = true;
            for (const itemToTake of moveAction.items) {
                const itemTaken = await playerProfile.character.removeItem(itemToTake.id, itemToTake.count);
                if (itemTaken) {
                    if (typeof itemTaken.changed !== "undefined") {
                        output.items.change = output.items.change.concat(itemTaken.changed);
                    }

                    if (typeof itemTaken.removed !== "undefined") {
                        output.items.del = output.items.del.concat(itemTaken.removed);
                    }
                } else {
                    allItemsTaken = false;
                }
                /*await trader.reduceStock(requestEntry.item_id, requestEntry.count);*/
            }

            if (allItemsTaken) {
                let productionTime = 0;

                if (typeof hideoutProductionTemplate.ProductionTime !== "undefined") {
                    productionTime = hideoutProductionTemplate.ProductionTime;
                } else if (typeof hideoutProductionTemplate.productionTime !== "undefined") {
                    productionTime = hideoutProductionTemplate.productionTime;
                }

                if (!hideoutProductionTemplate.count) {
                    hideoutProductionTemplate.count = 1;
                }

                const products = [{
                    _id: await generateMongoID(),
                    _tpl: hideoutProductionTemplate.endProduct,
                    count: hideoutProductionTemplate.count
                }];

                playerProfile.character.Hideout.Production[hideoutProductionTemplate._id] = {
                    Progress: 0,
                    inProgress: true,
                    Products: products,
                    RecipeId: moveAction.recepieId,
                    SkipTime: 0,
                    ProductionTime: parseInt(productionTime),
                    StartTimestamp: await getCurrentTimestamp()
                };

                return output;
            } else {
                // How do return custom error to client!!1!1!!!111!elf?
                logger.logError(`[singleProductionStart] Starting hideout production for recepie with Id ${moveAction.recipeId} failed. Unable to take required items.`);
                return;
            }
        }
    }

    static async continuousProductionStart(moveAction = null, _reply = null, playerProfile = null) {
        if (playerProfile) {
            const hideoutProductionTemplate = await HideoutProduction.get(moveAction.recipeId);
            if (!hideoutProductionTemplate) {
                logger.logError(`[continuousProductionStart] Couldn't start hideout production. Unknown production with Id ${moveAction.recipeId}`);
                return;
            }

            let productionTime = 0
            if (typeof hideoutProductionTemplate.ProductionTime !== "undefined") {
                productionTime = hideoutProductionTemplate.ProductionTime;
            } else if (typeof hideoutProductionTemplate.productionTime !== "undefined") {
                productionTime = hideoutProductionTemplate.productionTime;
            }

            playerProfile.character.Hideout.Production[hideoutProductionTemplate._id] = {
                Progress: 0,
                inProgress: true,
                RecipeId: moveAction.recipeId,
                SkipTime: 0,
                ProductionTime: parseInt(productionTime),
                StartTimestamp: await getCurrentTimestamp()
            };
        }
    }

    static async scavcaseProductionStart(moveAction = null, _reply = null, playerProfile = null) {
        const output = {
            items: {
                new: [],
                change: [],
                del: []
            }
        };
        if (playerProfile) {
            const hideoutScavcaseProduction = await HideoutScavcase.get(moveAction.recipeId);
            if (!hideoutScavcaseProduction) {
                logger.logError(`[scavcaseProductionStart] Couldn't start scavcase. Unknown hideout scavcase with Id ${moveAction.recipeId}`);
            }
            const itemTaken = await playerProfile.character.removeItem(moveAction.items[0].id, moveAction.items[0].count);

            const products = await hideoutScavcaseProduction.generateRewards();

            if (itemTaken) {
                output.items.change = itemTaken.changed;
                output.items.removed = itemTaken.removed;
                playerProfile.character.Hideout.Production[hideoutScavcaseProduction._id] = {
                    Progress: 0,
                    inProgress: true,
                    RecipeId: moveAction.recipeId,
                    Products: products,
                    SkipTime: 0,
                    ProductionTime: parseInt(hideoutScavcaseProduction.ProductionTime),
                    StartTimestamp: await getCurrentTimestamp()
                };
            } else {
                logger.logError(`[scavcaseProductionStart] Couldn't take money with id ${moveAction.items[0].id}`);
            }
        }
        return output;
    }

    static async takeProduction(moveAction = null, _reply = null, playerProfile = null) {
        const output = {
            items: {
                new: [],
                change: [],
                del: []
            }
        };
        // TODO: HANDLE STACK FOR BULLETS & BULLETS PACKS
        if (playerProfile) {
            let itemsAdded;
            const production = await playerProfile.character.getHideoutProductionById(moveAction.recipeId);
            if (!production.hasOwnProperty("Products")) {
                logger.logError(`[takeProduction] Remanent productions error: no products for production with Id ${moveAction.recipeId}`);
                await playerProfile.character.removeHideoutProductionById(moveAction.recipeId);
                return output;
            }
            for (const product of production.Products) {
                if (!product.count) {
                    product.count = 1;
                }
                const itemTemplate = await Item.get(product._tpl);
                if (await Preset.itemHasPreset(itemTemplate._id)) {
                    const itemPresets = await Preset.getPresetsForItem(itemTemplate._id);
                    const itemPreset = Object.values(itemPresets).find(preset => preset._encyclopedia);
                    const basedChildren = await Item.prepareChildrenForAddItem(itemPreset._items[0], itemPreset._items);
                    itemsAdded = await playerProfile.character.addItem(await playerProfile.character.getStashContainer(), itemTemplate._id, basedChildren, product.count, true);
                } else {
                    itemsAdded = await playerProfile.character.addItem(await playerProfile.character.getStashContainer(), itemTemplate._id, undefined, product.count, true);
                }
                if (itemsAdded) {
                    output.items.new = output.items.new.concat(itemsAdded);
                }
            }
            await playerProfile.character.removeHideoutProductionById(moveAction.recipeId);
        }
        return output;
    }

}

module.exports.HideoutController = HideoutController;