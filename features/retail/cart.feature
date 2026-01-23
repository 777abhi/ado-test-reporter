@cart @retail
Feature: Shopping Cart Management
  As a customer
  I want to manage items in my shopping cart
  So that I can purchase the correct items

  Background:
    Given I am logged in as a legitimate user
    And I have an empty shopping cart

  @critical
  @TC_713275
  Scenario: Add item to cart
    Given I am on the product details page for "Running Shoes"
    When I select size "42"
    And I click "Add to Cart"
    Then the mini-cart should show "1" item
    And I should see a success notification "Item added to cart"

  @TC_269259
  Scenario: Update item quantity in cart
    Given I have added "Running Shoes" to my cart
    When I navigate to the shopping cart page
    And I change the quantity of "Running Shoes" to 2
    Then the total price should be updated to reflect 2 items
    And the cart subtotal should be correct

  @negative
  @TC_354929
  Scenario: Remove item from cart
    Given I have the following items in my cart:
      | product       | quantity |
      | Running Shoes |        1 |
      | Water Bottle  |        2 |
    When I remove "Water Bottle" from the cart
    Then "Water Bottle" should no longer be visible in the cart
    But "Running Shoes" should remain in the cart
