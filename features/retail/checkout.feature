@checkout @retail
Feature: Checkout Process
  As a customer
  I want to complete my purchase
  So that I can receive my products

  Background:
    Given I am logged in
    And I have items in my shopping cart

  @critical @smoke
  @TC_731658
  Scenario: Guest Checkout with Credit Card
    Given I proceed to checkout
    When I enter the following shipping address:
      | Name    | Street      | City        | Zip   | Country |
      | Jane Do | 123 Main St | Springfield | 62704 | USA     |
    And I choose "Standard Shipping"
    And I enter valid credit card details
    And I place the order
    Then I should see the Order Confirmation page
    And I should receive an order confirmation email

  @TC_970794
  Scenario: Apple Pay Checkout
    Given I proceed to checkout
    When I select "Apple Pay" as the payment method
    And I authorize the payment
    Then the order should be processed successfully

  @negative
  @TC_619468
  Scenario: Checkout with expired credit card
    Given I proceed to checkout
    When I enter an expired credit card
    And I place the order
    Then I should see a payment error "Credit card is expired"
    And the order should not be created
